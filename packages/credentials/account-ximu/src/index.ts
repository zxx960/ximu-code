/** Email/password account provider; management tokens never authenticate inference or embedded pages. */
import { randomUUID } from 'node:crypto'
import { platform, release } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { DeepSeekAccount, type AccountDetails, type AccountGroupId, type AccountGroups, type AccountView, type SignInAttemptView, type SignInAttemptId, type SignInErrorCode } from '@deepseek-ai/dsh-deepseek-account'
import type { AccountApiKeyId, AccountGroupKey, AccountGroupKeys, AccountKeyCreation } from '@deepseek-ai/dsh-deepseek-account'

const KEY = credentialKey('account-ximu', 'default')
const token = z.string().regex(/^[\x21-\x7e]+$/)
const tokenPair = z.object({ access_token: token, refresh_token: token })
const grant = z.object({ version: z.literal(1), issuer: z.url(), token, refreshToken: token.optional(), sessionId: z.uuid().optional() })
type Grant = z.infer<typeof grant>
const account = z.object({ email: z.email(), balance: z.number() })
const groups = z.array(z.object({
  id: z.number().int().positive().transform(id => id as AccountGroupId),
  name: z.string().trim().min(1),
  platform: z.string().min(1),
})).refine(value => new Set(value.map(group => group.id)).size === value.length)
const keyPage = z.object({
  pages: z.number().int().nonnegative(),
  items: z.array(z.object({
    id: z.number().int().positive().transform(id => id as AccountApiKeyId),
    name: z.string(),
    key: z.string().regex(/^[\x21-\x7e]+$/),
    group_id: z.number().int().positive().nullable().optional(),
    status: z.string(),
    expires_at: z.iso.datetime({ offset: true }).nullable().optional(),
    quota: z.number().default(0),
    quota_used: z.number().default(0),
  })),
})

/** Ximu management API and bounded request settings. */
export interface Config {
  /** API root containing auth/login and auth/me. */
  baseURL?: string
  /** Deadline for a complete management request. */
  requestTimeoutMs?: number
  /** Maximum bytes in one management response. */
  maxResponseBytes?: number
  /** Maximum pages admitted for one complete group-key query. */
  maxKeyPages?: number
  /** Name assigned to a key created by an explicit user action. */
  keyName?: string
  /** Permit loopback HTTP for local API fixtures only. */
  allowLoopbackHttp?: boolean
}
/** Validated Ximu management settings. */
export const Config = Schema.object({
  baseURL: Schema.string().default('https://codex.ximuai.com/api/v1'),
  requestTimeoutMs: Schema.number().min(1).max(120_000).default(30_000),
  maxResponseBytes: Schema.number().min(1).max(1_048_576).step(1).default(65_536),
  maxKeyPages: Schema.number().min(1).max(1000).step(1).default(100),
  keyName: Schema.string().pattern(/\S/).default('西牧ai'),
  allowLoopbackHttp: Schema.boolean().default(false),
})

class AccountError extends Error {
  constructor(readonly code: SignInErrorCode, readonly responseStatus?: number) { super(`account: ${code}`) }
}

/** Stores and renews management credentials on the Host. Overlapping profile and balance reads share one request. */
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
  private pendingSave: { previous: Grant; renewed: Grant } | undefined
  private creatingKey: { groupId: AccountGroupId; generation: number; promise: Promise<AccountKeyCreation> } | undefined
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
      await this.creatingKey?.promise
      await Promise.allSettled(this.requests)
      this.changed()
    }, 'ximu: account lifetime')
  }

  async [Service.init](): Promise<void> { await this.readGrant() }

  override async getState(): Promise<AccountView> {
    return { status: await this.readGrant() === undefined ? 'signed-out' : 'credential-stored',
      loginMethod: 'password', attempt: this.attempt,
      links: { usageUrl: new URL(this.settings.baseURL).origin, topUpUrl: new URL('/purchase', this.settings.baseURL).href } }
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
        const pair = tokenPair.partial({ refresh_token: true }).safeParse(value)
        if (!pair.success) throw new AccountError('protocol')
        const payload: Grant = { version: 1, issuer: this.settings.baseURL, token: pair.data.access_token }
        if (pair.data.refresh_token !== undefined) {
          payload.refreshToken = pair.data.refresh_token
          payload.sessionId = randomUUID()
        }
        controller.signal.throwIfAborted()
        this.lifetime.signal.throwIfAborted()
        operation.committing = true
        this.setPhase(id, 'committing')
        try {
          await this.ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'grant', payload }))
          this.pendingSave = undefined
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
      this.pendingSave = undefined
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
    let stored: Grant | undefined
    try {
      stored = await this.readGrant()
      if (stored === undefined || !await this.isCurrent(stored, generation)) return null
      const { value } = await this.authenticatedRequest(stored, 'groups/available', {}, this.lifetime.signal)
      const result = groups.safeParse(value)
      if (!result.success) throw new AccountError('protocol')
      return await this.isCurrent(stored, generation) ? { status: 'ready', value: result.data } : null
    } catch (error) {
      return await this.readFailure(error, stored, generation)
    }
  }

  override async getGroupKeys(groupId: AccountGroupId): Promise<AccountGroupKeys> {
    const generation = this.generation
    let stored: Grant | undefined
    try {
      if (!z.number().int().positive().safeParse(groupId).success) throw new AccountError('protocol')
      stored = await this.readGrant()
      if (stored === undefined || !await this.isCurrent(stored, generation)) return null
      const deadline = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.settings.requestTimeoutMs)])
      const values: z.infer<typeof keyPage>['items'] = []
      const ids = new Set<AccountApiKeyId>()
      let pages = 1
      for (let page = 1; page <= pages; page++) {
        const query = new URLSearchParams({ page: String(page), page_size: '100', group_id: String(groupId) })
        const response = await this.authenticatedRequest(stored, `keys?${query}`, {}, deadline)
        stored = response.grant
        const result = keyPage.safeParse(response.value)
        deadline.throwIfAborted()
        if (!await this.isCurrent(stored, generation)) return null
        if (!result.success || result.data.pages > this.settings.maxKeyPages
          || (page > 1 && result.data.pages !== pages)
          || (result.data.pages === 0 && result.data.items.length > 0)) throw new AccountError('protocol')
        pages = result.data.pages
        for (const item of result.data.items) {
          if (ids.has(item.id)) throw new AccountError('protocol')
          ids.add(item.id)
          values.push(item)
        }
      }
      const now = Date.now()
      const keys: AccountGroupKey[] = values.filter(item => item.status === 'active'
        && (item.group_id === undefined || item.group_id === groupId)
        && (item.expires_at == null || Date.parse(item.expires_at) > now)
        && (item.quota <= 0 || item.quota_used < item.quota))
        .map(({ id, name, key }) => ({ id, name, key }))
      return { status: 'ready', value: keys }
    } catch (error) {
      return await this.readFailure(error, stored, generation)
    }
  }

  override createGroupKey(groupId: AccountGroupId): Promise<AccountKeyCreation> {
    if (this.creatingKey !== undefined) {
      return this.creatingKey.groupId === groupId && this.creatingKey.generation === this.generation
        ? this.creatingKey.promise : Promise.resolve({ status: 'failed' })
    }
    const pending = { groupId, generation: this.generation, promise: Promise.resolve<AccountKeyCreation>(null) }
    pending.promise = this.createKey(groupId, pending.generation).finally(() => {
      if (this.creatingKey === pending) this.creatingKey = undefined
    })
    this.creatingKey = pending
    return pending.promise
  }

  private async createKey(groupId: AccountGroupId, generation: number): Promise<AccountKeyCreation> {
    let submitted = false
    try {
      if (!z.number().int().positive().safeParse(groupId).success) return { status: 'failed' }
      const stored = await this.readGrant()
      if (stored === undefined || !await this.isCurrent(stored, generation)) return null
      submitted = true
      const { value } = await this.authenticatedRequest(stored, 'keys', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: this.settings.keyName, group_id: groupId }),
      }, this.lifetime.signal)
      const result = keyPage.shape.items.element.safeParse(value)
      if (!result.success || (result.data.group_id !== undefined && result.data.group_id !== groupId)
        || !await this.isCurrent(stored, generation)) return { status: 'unknown' }
      return { status: 'created', id: result.data.id }
    } catch (error) {
      if (error instanceof AccountError && error.code === 'expired') return null
      const rejected = error instanceof AccountError && error.responseStatus !== undefined
        && error.responseStatus >= 400 && error.responseStatus < 500 && error.responseStatus !== 408
      return { status: submitted && !rejected ? 'unknown' : 'failed' }
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

  private async readGrant(): Promise<Grant | undefined> {
    return this.parseGrant(await this.ctx.credentials.readRecord(KEY))
  }

  private parseGrant(record: CredentialRecord | undefined): Grant | undefined {
    if (record === undefined) return undefined
    const result = record.kind === 'grant' ? grant.safeParse(record.payload) : undefined
    if (!result?.success || result.data.issuer !== this.settings.baseURL) throw new AccountError('storage')
    return result.data
  }

  private sameSession(stored: Grant, current: Grant | undefined): boolean {
    if (current === undefined) return false
    return stored.sessionId === undefined ? stored.token === current.token : stored.sessionId === current.sessionId
  }

  private sameGrant(stored: Grant, current: Grant | undefined): boolean {
    return current !== undefined && this.sameSession(stored, current)
      && stored.token === current.token && stored.refreshToken === current.refreshToken
  }

  private async isCurrent(stored: Grant, generation: number): Promise<boolean> {
    const matches = generation === this.generation || this.sameSession(stored, await this.readGrant())
    return matches && this.removing === undefined && !this.lifetime.signal.aborted
  }

  private async readFailure(error: unknown, stored: Grant | undefined, generation: number): Promise<{ status: 'failed' } | null> {
    if (error instanceof AccountError && error.code === 'expired') return null
    return stored !== undefined && !await this.isCurrent(stored, generation) ? null : { status: 'failed' }
  }

  private async readAccount(): Promise<z.infer<typeof account> | null> {
    const generation = this.generation
    const stored = await this.readGrant()
    if (stored === undefined || !await this.isCurrent(stored, generation)) return null
    if (this.detail?.token === stored.token) return this.detail.promise
    const pending = { token: stored.token, promise: Promise.resolve<z.infer<typeof account> | null>(null) }
    pending.promise = (async () => {
      try {
        const { value } = await this.authenticatedRequest(stored, 'auth/me', {}, this.lifetime.signal)
        const result = account.safeParse(value)
        if (!result.success) throw new AccountError('protocol')
        return await this.isCurrent(stored, generation) ? result.data : null
      } catch (error) {
        if (await this.readFailure(error, stored, generation) === null) return null
        throw error
      }
    })().finally(() => { if (this.detail === pending) this.detail = undefined })
    this.detail = pending
    return pending.promise
  }

  private async expireGrant(stored: Grant): Promise<void> {
    const generation = this.generation
    if (!this.sameGrant(stored, await this.readGrant()) || generation !== this.generation
      || this.removing !== undefined || this.lifetime.signal.aborted) return
    await this.signOut()
    this.ctx.emit('deepseek-account/session-expired')
  }

  private async authenticatedRequest(
    stored: Grant, path: string, init: RequestInit, signal: AbortSignal,
  ): Promise<{ value: unknown; grant: Grant }> {
    const send = async (current: Grant) => {
      const headers = new Headers(init.headers)
      headers.set('authorization', `Bearer ${current.token}`)
      return { value: await this.request(path, { ...init, headers }, signal), grant: current }
    }
    try { return await send(stored) }
    catch (error) {
      if (!(error instanceof AccountError) || error.code !== 'expired') throw error
    }

    let renewed: Grant | undefined
    try {
      if (stored.refreshToken !== undefined) renewed = await this.track(this.renewGrant(stored, signal))
    } catch (error) {
      if (error instanceof AccountError && error.code === 'expired') await this.expireGrant(stored)
      // The authenticated request was rejected before the renewal failure.
      throw new AccountError(error instanceof AccountError ? error.code : 'storage', 401)
    }
    const current = renewed === undefined ? undefined : await this.readGrant()
    if (signal.aborted) throw new AccountError('no-response', 401)
    if (renewed === undefined) {
      await this.expireGrant(stored)
      throw new AccountError('expired', 401)
    }
    if (this.removing !== undefined || !this.sameSession(renewed, current)) {
      throw new AccountError('expired', 401)
    }
    try { return await send(renewed) }
    catch (error) {
      if (error instanceof AccountError && error.code === 'expired') await this.expireGrant(renewed)
      throw error
    }
  }

  private async renewGrant(stored: Grant, signal: AbortSignal): Promise<Grant | undefined> {
    // The credential transaction serializes refresh-token rotation across processes.
    const record = await this.ctx.credentials.modifyRecord(KEY, async (record) => {
      const current = this.parseGrant(record)
      if (current === undefined || !this.sameGrant(stored, current) || current.refreshToken === undefined
        || this.removing !== undefined || signal.aborted || this.lifetime.signal.aborted) return undefined
      if (this.pendingSave !== undefined && this.sameGrant(this.pendingSave.previous, current)) {
        return { kind: 'grant', payload: this.pendingSave.renewed }
      }
      const value = await this.request('auth/refresh', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: current.refreshToken }),
      }, this.lifetime.signal)
      const pair = tokenPair.safeParse(value)
      if (!pair.success) throw new AccountError('protocol')
      const renewed = { ...current, token: pair.data.access_token, refreshToken: pair.data.refresh_token }
      this.pendingSave = { previous: current, renewed }
      return { kind: 'grant', payload: renewed }
    })
    const current = this.parseGrant(record)
    if (this.pendingSave !== undefined && this.sameGrant(this.pendingSave.renewed, current)) this.pendingSave = undefined
    return this.sameSession(stored, current) && !this.sameGrant(stored, current) ? current : undefined
  }

  private request(path: string, init: RequestInit, signal: AbortSignal, login = false): Promise<unknown> {
    return this.track(this.fetchResponse(path, init, signal, login))
  }

  private track<T>(request: Promise<T>): Promise<T> {
    const pending = request.finally(() => { this.requests.delete(pending) })
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
      throw new AccountError(response.status === 401 ? login ? 'invalid-credentials' : 'expired' : 'network', response.status)
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
