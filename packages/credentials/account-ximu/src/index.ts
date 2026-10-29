/** Email/password account provider; management tokens never authenticate inference or embedded pages. */
import { randomUUID } from 'node:crypto'
import { platform, release } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { DeepSeekAccount, type AccountDetails, type AccountGroupId, type AccountGroups, type AccountView, type SignInAttemptView, type SignInAttemptId, type SignInErrorCode } from '@deepseek-ai/dsh-deepseek-account'

const KEY = credentialKey('account-ximu', 'default')
const grant = z.object({ version: z.literal(1), issuer: z.url(), token: z.string().regex(/^[\x21-\x7e]+$/) })
const account = z.object({ email: z.email(), balance: z.number() })
const groups = z.array(z.object({
  id: z.number().int().positive().transform(id => id as AccountGroupId),
  name: z.string().trim().min(1),
  platform: z.string().min(1),
})).refine(value => new Set(value.map(group => group.id)).size === value.length)

/** Ximu management API and bounded request settings. */
export interface Config {
  /** API root containing auth/login and auth/me. */
  baseURL?: string
  /** Deadline for a complete management request. */
  requestTimeoutMs?: number
  /** Maximum bytes in one management response. */
  maxResponseBytes?: number
  /** Permit loopback HTTP for local API fixtures only. */
  allowLoopbackHttp?: boolean
}
/** Validated Ximu management settings. */
export const Config = Schema.object({
  baseURL: Schema.string().default('https://codex.ximuai.com/api/v1'),
  requestTimeoutMs: Schema.number().min(1).max(120_000).default(30_000),
  maxResponseBytes: Schema.number().min(1).max(1_048_576).step(1).default(65_536),
  allowLoopbackHttp: Schema.boolean().default(false),
})

class AccountError extends Error {
  constructor(readonly code: SignInErrorCode) { super(`account: ${code}`) }
}

/** Stores only the management token; profile and balance reads share an in-flight auth/me request. */
export class XimuAccount extends DeepSeekAccount {
  static inject = ['credentials']
  static Config = Config
  private readonly settings: Required<Config>
  private readonly lifetime = new AbortController()
  private readonly listeners = new Set<() => void>()
  private attempt: SignInAttemptView | null = null
  private active: { controller: AbortController; done: Promise<AccountView>; committing: boolean } | undefined
  private removing: Promise<AccountView> | undefined
  private readonly requests = new Set<Promise<unknown>>()
  private generation = 0
  private detail: { token: string; promise: Promise<z.infer<typeof account> | null> } | undefined

  /** @param ctx - Host credential owner. @param config - management API settings. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    this.settings = Config(config)
    const url = new URL(this.settings.baseURL)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.username || url.password || url.search || url.hash
      || !(url.protocol === 'https:' || (this.settings.allowLoopbackHttp && loopback && url.protocol === 'http:'))) {
      throw new Error('account-ximu: baseURL must use HTTPS, or explicitly enabled loopback HTTP, without credentials, query or fragment')
    }
    this.settings.baseURL = url.href.replace(/\/$/, '')
    ctx.on('credentials/record-updated', (key) => {
      if (key !== KEY) return
      this.generation++
      this.detail = undefined
      this.changed()
    })
    ctx.effect(() => async () => {
      this.lifetime.abort()
      if (!this.active?.committing) this.active?.controller.abort()
      await this.active?.done
      await this.removing
      await Promise.allSettled(this.requests)
      this.changed()
    }, 'ximu: account lifetime')
  }

  async [Service.init](): Promise<void> { await this.readGrant() }

  override async getState(): Promise<AccountView> {
    return { status: await this.readGrant() === undefined ? 'signed-out' : 'credential-stored',
      loginMethod: 'password', attempt: this.attempt,
      links: { usageUrl: new URL(this.settings.baseURL).origin, topUpUrl: new URL(this.settings.baseURL).origin } }
  }

  override startSignIn(): Promise<AccountView> { return this.getState() }

  override async signInWithPassword(email: string, password: string): Promise<AccountView> {
    if (this.removing !== undefined) await this.removing
    if (this.lifetime.signal.aborted) throw new AccountError('protocol')
    if (this.active !== undefined) return this.active.done
    const parsedEmail = z.email().max(320).safeParse(email.trim())
    if (!parsedEmail.success || password.length === 0 || password.length > 4096) {
      throw new AccountError('invalid-credentials')
    }
    const controller = new AbortController()
    const id = randomUUID() as SignInAttemptId
    this.attempt = { id, phase: 'initializing' }
    const completion = Promise.withResolvers<AccountView>()
    const operation = { controller, committing: false, done: completion.promise }
    this.active = operation
    const running = (async () => {
      try {
        const value = await this.request('auth/login', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: parsedEmail.data, password }),
        }, controller.signal, true)
        const token = z.object({ access_token: grant.shape.token }).safeParse(value)
        if (!token.success) throw new AccountError('protocol')
        controller.signal.throwIfAborted()
        this.lifetime.signal.throwIfAborted()
        operation.committing = true
        this.setPhase(id, 'committing')
        try {
          await this.ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'grant',
            payload: { version: 1, issuer: this.settings.baseURL, token: token.data.access_token } }))
        } catch { throw new AccountError('storage') }
        this.setPhase(id, 'succeeded')
      } catch (error) {
        if (controller.signal.aborted || this.lifetime.signal.aborted) this.setPhase(id, 'cancelled')
        else this.setPhase(id, 'failed', error instanceof AccountError ? error.code : 'protocol')
      }
      return this.getState()
    })().finally(() => { this.active = undefined })
    void running.then(completion.resolve, completion.reject)
    this.changed()
    return operation.done
  }

  override async cancelSignIn(id: SignInAttemptId): Promise<AccountView> {
    if (this.attempt?.id === id && this.active !== undefined) {
      if (!this.active.committing) this.active.controller.abort()
      await this.active.done
    }
    return this.getState()
  }

  override signOut(): Promise<AccountView> {
    this.removing ??= (async () => {
      if (this.attempt !== null) await this.cancelSignIn(this.attempt.id)
      await this.ctx.credentials.deleteRecord(KEY)
      this.attempt = null
      this.ctx.emit('deepseek-account/signed-out')
      this.changed()
      return this.getState()
    })().finally(() => { this.removing = undefined })
    return this.removing
  }

  override async getProfile(): Promise<AccountDetails['profile'] | null> {
    try {
      const value = await this.readAccount()
      return value === null ? null : { status: 'ready', value: { id: null, name: value.email, contact: value.email } }
    } catch { return { status: 'failed' } }
  }

  override async getBalance(): Promise<AccountDetails['balance'] | null> {
    try {
      const value = await this.readAccount()
      return value === null ? null : { status: 'ready', value: [{ balance: String(value.balance) }], bonusWallets: [] }
    } catch { return { status: 'failed' } }
  }

  override async getGroups(): Promise<AccountGroups> {
    const generation = this.generation
    let token: string | undefined
    try {
      token = (await this.readGrant())?.token
      if (token === undefined || generation !== this.generation || this.lifetime.signal.aborted) return null
      const result = groups.safeParse(await this.request('groups/available', {
        headers: { authorization: `Bearer ${token}` },
      }, this.lifetime.signal))
      if (!result.success) throw new AccountError('protocol')
      this.lifetime.signal.throwIfAborted()
      return generation === this.generation ? { status: 'ready', value: result.data } : null
    } catch (error) {
      if (generation !== this.generation || this.lifetime.signal.aborted) return null
      if (error instanceof AccountError && error.code === 'expired' && token !== undefined) {
        await this.expireGrant(token, generation)
        return null
      }
      return { status: 'failed' }
    }
  }

  override getUnnotifiedBonuses(): Promise<null> { return Promise.resolve(null) }
  override ackBonusNotified(): Promise<boolean> { return Promise.resolve(false) }
  override resolveToken(): Promise<undefined> { return Promise.resolve(undefined) }
  override rejectToken(): Promise<void> { return Promise.resolve() }
  override getPlatformSession(): Promise<null> { return Promise.resolve(null) }
  override getDeviceIdentity(): Promise<{ osVersion: string }> { return Promise.resolve({ osVersion: `${platform()} ${release()}` }) }

  override async *watch(signal: AbortSignal): AsyncIterable<AccountView> {
    let dirty = true
    let wake: (() => void) | undefined
    const notify = (): void => { dirty = true; wake?.() }
    this.listeners.add(notify)
    signal.addEventListener('abort', notify, { once: true })
    try {
      while (!signal.aborted && !this.lifetime.signal.aborted) {
        if (dirty) { dirty = false; yield await this.getState(); continue }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally { this.listeners.delete(notify); signal.removeEventListener('abort', notify) }
  }

  private changed(): void { for (const listener of this.listeners) listener() }
  private setPhase(id: SignInAttemptId, phase: SignInAttemptView['phase'], errorCode?: SignInErrorCode): void {
    this.attempt = { id, phase, ...errorCode === undefined ? {} : { errorCode } }
    this.changed()
  }

  private async readGrant(): Promise<z.infer<typeof grant> | undefined> {
    const record = await this.ctx.credentials.readRecord(KEY)
    if (record === undefined) return undefined
    const result = record.kind === 'grant' ? grant.safeParse(record.payload) : undefined
    if (!result?.success || result.data.issuer !== this.settings.baseURL) throw new AccountError('storage')
    return result.data
  }

  private async readAccount(): Promise<z.infer<typeof account> | null> {
    const generation = this.generation
    const stored = await this.readGrant()
    if (stored === undefined || generation !== this.generation || this.lifetime.signal.aborted) return null
    if (this.detail?.token === stored.token) return this.detail.promise
    const pending = { token: stored.token, promise: Promise.resolve<z.infer<typeof account> | null>(null) }
    pending.promise = (async () => {
      try {
        const result = account.safeParse(await this.request('auth/me', { headers: { authorization: `Bearer ${stored.token}` } }, this.lifetime.signal))
        if (!result.success) throw new AccountError('protocol')
        return generation === this.generation ? result.data : null
      } catch (error) {
        if (generation !== this.generation || this.lifetime.signal.aborted) return null
        if (!(error instanceof AccountError) || error.code !== 'expired') throw error
        await this.expireGrant(stored.token, generation)
        return null
      }
    })().finally(() => { if (this.detail === pending) this.detail = undefined })
    this.detail = pending
    return pending.promise
  }

  private async expireGrant(token: string, generation: number): Promise<void> {
    if ((await this.readGrant())?.token !== token || generation !== this.generation || this.removing !== undefined) return
    await this.signOut()
    this.ctx.emit('deepseek-account/session-expired')
  }

  private request(path: string, init: RequestInit, signal: AbortSignal, login = false): Promise<unknown> {
    const pending = this.fetchResponse(path, init, signal, login).finally(() => { this.requests.delete(pending) })
    this.requests.add(pending)
    return pending
  }

  private async fetchResponse(path: string, init: RequestInit, signal: AbortSignal, login: boolean): Promise<unknown> {
    const deadline = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(this.settings.requestTimeoutMs)])
    let response: Response
    try { response = await fetch(`${this.settings.baseURL}/${path}`, { ...init, redirect: 'error', signal: deadline }) }
    catch { throw new AccountError('no-response') }
    if (!response.ok) {
      await response.body?.cancel()
      throw new AccountError(response.status === 401 ? login ? 'invalid-credentials' : 'expired' : 'network')
    }
    if (response.body === null) throw new AccountError('protocol')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > this.settings.maxResponseBytes) throw new AccountError('protocol')
        chunks.push(next.value)
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (typeof body === 'object' && body !== null && 'code' in body && Number.isInteger(body.code)) {
        if (body.code !== 0 || !('data' in body)) throw new AccountError('protocol')
        return body.data
      }
      return body
    } catch (error) {
      throw error instanceof AccountError ? error : new AccountError('protocol')
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  }
}
export default XimuAccount
