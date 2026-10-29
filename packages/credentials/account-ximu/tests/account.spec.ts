/** Real management HTTP responses and durable credential behavior. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { afterEach, expect, it, vi } from 'vitest'
import XimuAccount from '../src/index.ts'
import type { AccountUserId, AccountBonusOrderId, AccountGroupId, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account'

const client = { version: 'test', locale: 'en', timezoneOffsetSeconds: 0 }
const key = credentialKey('account-ximu', 'default')

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); while (cleanups.length > 0) await cleanups.pop()!() })

async function fixture(wrapped = false) {
  const root = await mkdtemp(join(tmpdir(), 'ximu-account-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  let status = 200
  let balance = 12.34
  let loginResponse: unknown = { access_token: 'synthetic-account-token' }
  let groups: unknown = [{ id: 7, name: 'OpenAI group', platform: 'openai' }]
  let keys: unknown[] = [{ pages: 1, items: [{ id: 12, name: 'Test key', key: 'synthetic-inference-key', group_id: 7, status: 'active' }] }]
  let created: unknown = { id: 13, name: '西牧ai', key: 'synthetic-created-key', group_id: 7, status: 'active' }
  let release: Promise<void> | undefined
  const requested = Promise.withResolvers<undefined>()
  const detailRequested = Promise.withResolvers<undefined>()
  const groupsRequested = Promise.withResolvers<undefined>()
  const keysRequested = Promise.withResolvers<undefined>()
  const createRequested = Promise.withResolvers<undefined>()
  const seen: Array<{ path: string | undefined; auth: string | undefined; body: string }> = []
  const server = createServer((req, res) => { void handle(req, res).catch(() => res.destroy()) })
  async function handle(req: IncomingMessage, res: ServerResponse) {
    let body = ''
    for await (const chunk of req) body += String(chunk)
    seen.push({ path: req.url, auth: req.headers.authorization, body })
    requested.resolve(undefined)
    if (req.url === '/api/v1/auth/me') detailRequested.resolve(undefined)
    if (req.url === '/api/v1/groups/available') groupsRequested.resolve(undefined)
    if (req.url?.startsWith('/api/v1/keys?')) keysRequested.resolve(undefined)
    if (req.url === '/api/v1/keys' && req.method === 'POST') createRequested.resolve(undefined)
    if (release !== undefined) await release
    if (res.destroyed) return
    const data = req.url === '/api/v1/auth/login' ? loginResponse
      : req.url === '/api/v1/groups/available' ? groups
        : req.url?.startsWith('/api/v1/keys?') ? keys[Number(new URL(req.url, 'http://localhost').searchParams.get('page')) - 1]
          : req.url === '/api/v1/keys' && req.method === 'POST' ? created : { email: 'test@example.com', balance }
    if (req.url === '/api/v1/keys' && req.method === 'POST' && status === 200) keys = [{ pages: 1, items: [created] }]
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(wrapped ? { code: 0, data } : data))
  }
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing fixture address')
  const ctx = new Context()
  const credentials = ctx.plugin(LocalCredentialProvider, { dshHome: root, watch: false })
  cleanups.push(() => credentials.dispose())
  await credentials
  const provider = ctx.plugin(XimuAccount, { baseURL: `http://127.0.0.1:${address.port}/api/v1`, allowLoopbackHttp: true })
  cleanups.push(() => provider.dispose())
  await provider
  return { ctx, root, seen, provider, detailRequested: detailRequested.promise,
    groupsRequested: groupsRequested.promise, keysRequested: keysRequested.promise,
    createRequested: createRequested.promise, requested: requested.promise,
    status: (value: number) => { status = value }, balance: (value: number) => { balance = value },
    loginResponse: (value: unknown) => { loginResponse = value }, hold: (value: Promise<void>) => { release = value },
    groups: (value: unknown) => { groups = value }, keys: (value: unknown[]) => { keys = value },
    created: (value: unknown) => { created = value } }
}

const groupId = 7 as AccountGroupId

it.each([false, true])('creates a group key explicitly and exposes it on a subsequent list query (wrapped=%s)', async (wrapped) => {
  const f = await fixture(wrapped)
  expect(await f.ctx.deepseekAccount.createGroupKey(groupId)).toBeNull()
  expect(f.seen).toHaveLength(0)
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  expect(await f.ctx.deepseekAccount.createGroupKey(groupId)).toEqual({ status: 'created', id: 13 })
  const request = f.seen.find(item => item.path === '/api/v1/keys')!
  expect(request.auth).toBe('Bearer synthetic-account-token')
  expect(JSON.parse(request.body)).toEqual({ name: '西牧ai', group_id: 7 })
  expect(await f.ctx.deepseekAccount.getGroupKeys(groupId)).toEqual({ status: 'ready', value: [
    { id: 13, name: '西牧ai', key: 'synthetic-created-key' },
  ] })
})

it('coalesces concurrent creation clicks without submitting a second POST', async () => {
  const f = await fixture()
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  const release = Promise.withResolvers<undefined>()
  f.hold(release.promise)
  const first = f.ctx.deepseekAccount.createGroupKey(groupId)
  expect(f.ctx.deepseekAccount.createGroupKey(groupId)).toBe(first)
  try {
    await f.createRequested
    expect(await f.ctx.deepseekAccount.createGroupKey(8 as AccountGroupId)).toEqual({ status: 'failed' })
  } finally { release.resolve(undefined) }
  expect(await first).toEqual({ status: 'created', id: 13 })
  expect(f.seen.filter(item => item.path === '/api/v1/keys')).toHaveLength(1)
})

it.each([[400, 'failed'], [403, 'failed'], [500, 'unknown'], [408, 'unknown']])(
  'distinguishes rejected and uncertain key creation (HTTP %s)', async (status, result) => {
    const f = await fixture()
    await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
    f.status(status)
    expect(await f.ctx.deepseekAccount.createGroupKey(groupId)).toEqual({ status: result })
    expect(f.seen.filter(item => item.path === '/api/v1/keys')).toHaveLength(1)
  },
)

it('reports an unknown outcome if a successful POST returns an invalid response', async () => {
  const f = await fixture()
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  f.created({})
  expect(await f.ctx.deepseekAccount.createGroupKey(groupId)).toEqual({ status: 'unknown' })
})

it('reports the in-flight mutation as unknown after sign-out', async () => {
  const f = await fixture()
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  const release = Promise.withResolvers<undefined>()
  f.hold(release.promise)
  const pending = f.ctx.deepseekAccount.createGroupKey(groupId)
  try {
    await f.createRequested
    await f.ctx.deepseekAccount.signOut(client)
  } finally { release.resolve(undefined) }
  expect(await pending).toEqual({ status: 'unknown' })
  expect((await f.ctx.deepseekAccount.getState()).status).toBe('signed-out')
})

it('invalidates an expired management grant when key creation is rejected with 401', async () => {
  const f = await fixture()
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  f.status(401)
  expect(await f.ctx.deepseekAccount.createGroupKey(groupId)).toBeNull()
  expect((await f.ctx.deepseekAccount.getState()).status).toBe('signed-out')
})

it.each([false, true])('reads usable group keys across pages (wrapped=%s)', async (wrapped) => {
  const f = await fixture(wrapped)
  expect(await f.ctx.deepseekAccount.getGroupKeys(groupId)).toBeNull()
  expect(f.seen).toHaveLength(0)
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  const base = { id: 12, name: 'Same name', key: 'first-secret', group_id: 7, status: 'active' }
  f.keys([
    { pages: 2, items: [base,
      { ...base, id: 13, status: 'disabled' }, { ...base, id: 14, group_id: 8 },
      { ...base, id: 15, expires_at: '2000-01-01T00:00:00Z' },
      { ...base, id: 16, quota: 10, quota_used: 10 }, { ...base, id: 17, group_id: null },
    ] },
    { pages: 2, items: [{ ...base, id: 18, key: 'second-secret', expires_at: '2999-01-01T00:00:00Z', quota: 10, quota_used: 1 }] },
  ])
  expect(await f.ctx.deepseekAccount.getGroupKeys(groupId)).toEqual({ status: 'ready', value: [
    { id: 12, name: 'Same name', key: 'first-secret' }, { id: 18, name: 'Same name', key: 'second-secret' },
  ] })
  const requests = f.seen.filter(item => item.path?.startsWith('/api/v1/keys?'))
  expect(requests.map(item => item.path)).toEqual([
    '/api/v1/keys?page=1&page_size=100&group_id=7', '/api/v1/keys?page=2&page_size=100&group_id=7',
  ])
  expect(requests.every(item => item.auth === 'Bearer synthetic-account-token')).toBe(true)
  f.keys([{ pages: 0, items: [] }])
  expect(await f.ctx.deepseekAccount.getGroupKeys(groupId)).toEqual({ status: 'ready', value: [] })
})

it.each([
  [{ pages: 1, items: [{ id: 12, name: 'Key', key: 'bad\nsecret', status: 'active' }] }],
  [{ pages: 101, items: [] }], [{ pages: 2, items: [] }, { pages: 3, items: [] }],
  [{ pages: 1, items: [{ id: 12, name: 'Key', key: 'secret', status: 'active', expires_at: 'invalid' }] }],
])('rejects malformed or incomplete key listings without discarding login', async (...pages) => {
  const f = await fixture()
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  f.keys(pages)
  expect(await f.ctx.deepseekAccount.getGroupKeys(groupId)).toEqual({ status: 'failed' })
  expect((await f.ctx.deepseekAccount.getState()).status).toBe('credential-stored')
})

it('retries failed key reads and invalidates expired management credentials', async () => {
  const f = await fixture()
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  f.status(503)
  expect(await f.ctx.deepseekAccount.getGroupKeys(groupId)).toEqual({ status: 'failed' })
  f.status(200)
  expect(await f.ctx.deepseekAccount.getGroupKeys(groupId)).toMatchObject({ status: 'ready' })
  f.status(401)
  expect(await f.ctx.deepseekAccount.getGroupKeys(groupId)).toBeNull()
  expect((await f.ctx.deepseekAccount.getState()).status).toBe('signed-out')
})

it('discards key responses that arrive after sign-out', async () => {
  const f = await fixture()
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  const release = Promise.withResolvers<undefined>()
  f.hold(release.promise)
  const pending = f.ctx.deepseekAccount.getGroupKeys(groupId)
  try { await f.keysRequested; await f.ctx.deepseekAccount.signOut(client) }
  finally { release.resolve(undefined) }
  expect(await pending).toBeNull()
})

it.each([false, true])('reads only display-safe available groups (wrapped=%s)', async (wrapped) => {
  const f = await fixture(wrapped)
  expect(await f.ctx.deepseekAccount.getGroups()).toBeNull()
  expect(f.seen).toHaveLength(0)
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  f.groups([{ id: 7, name: 'OpenAI group', platform: 'openai', secret: 'private' }])
  expect(await f.ctx.deepseekAccount.getGroups()).toEqual({ status: 'ready', value: [{ id: 7, name: 'OpenAI group', platform: 'openai' }] })
  expect(f.seen.at(-1)).toMatchObject({ path: '/api/v1/groups/available', auth: 'Bearer synthetic-account-token' })
  f.groups([])
  expect(await f.ctx.deepseekAccount.getGroups()).toEqual({ status: 'ready', value: [] })
})

it.each([
  {}, [{ id: 0, name: 'bad', platform: 'openai' }], [{ id: 7, name: ' ', platform: 'openai' }],
  [{ id: 7, name: 'A', platform: 'openai' }, { id: 7, name: 'B', platform: 'openai' }],
])('reports malformed groups without clearing the login', async (value) => {
  const f = await fixture()
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  f.groups(value)
  expect(await f.ctx.deepseekAccount.getGroups()).toEqual({ status: 'failed' })
  expect((await f.ctx.deepseekAccount.getState()).status).toBe('credential-stored')
})

it('permits group-query retry and clears an expired login', async () => {
  const f = await fixture()
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  f.status(503)
  expect(await f.ctx.deepseekAccount.getGroups()).toEqual({ status: 'failed' })
  f.status(200)
  expect(await f.ctx.deepseekAccount.getGroups()).toMatchObject({ status: 'ready' })
  const expired = vi.fn()
  f.ctx.on('deepseek-account/session-expired', expired)
  f.status(401)
  expect(await f.ctx.deepseekAccount.getGroups()).toBeNull()
  expect((await f.ctx.deepseekAccount.getState()).status).toBe('signed-out')
  expect(expired).toHaveBeenCalledOnce()
})

it('discards groups that arrive after sign-out', async () => {
  const f = await fixture()
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  const release = Promise.withResolvers<undefined>()
  f.hold(release.promise)
  const pending = f.ctx.deepseekAccount.getGroups()
  try {
    await f.groupsRequested
    await f.ctx.deepseekAccount.signOut(client)
  } finally { release.resolve(undefined) }
  expect(await pending).toBeNull()
})

it('publishes one expiry notification when account and group reads both return 401', async () => {
  const f = await fixture()
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  const expired = vi.fn()
  f.ctx.on('deepseek-account/session-expired', expired)
  const release = Promise.withResolvers<undefined>()
  f.status(401)
  f.hold(release.promise)
  const balance = f.ctx.deepseekAccount.getBalance(client)
  const groups = f.ctx.deepseekAccount.getGroups()
  try { await Promise.all([f.detailRequested, f.groupsRequested]) }
  finally { release.resolve(undefined) }
  expect(await Promise.all([balance, groups])).toEqual([null, null])
  expect(expired).toHaveBeenCalledOnce()
})

it.each([false, true])('signs in and reads a currency-free recharge balance (wrapped=%s)', async (wrapped) => {
  const f = await fixture(wrapped)
  const state = await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  expect(state).toMatchObject({ status: 'credential-stored', loginMethod: 'password', attempt: { phase: 'succeeded' } })
  expect(JSON.stringify(state)).not.toContain('synthetic-account-token')
  const [profile, balance] = await Promise.all([
    f.ctx.deepseekAccount.getProfile({ version: 'test', locale: 'en', timezoneOffsetSeconds: 0 }),
    f.ctx.deepseekAccount.getBalance({ version: 'test', locale: 'en', timezoneOffsetSeconds: 0 }),
  ])
  expect(profile).toMatchObject({ status: 'ready', value: { name: 'test@example.com', contact: 'test@example.com', id: null } })
  expect(balance).toEqual({ status: 'ready', value: [{ balance: '12.34' }], bonusWallets: [] })
  expect(f.seen.filter(request => request.path === '/api/v1/auth/me')).toHaveLength(1)
  expect(f.seen.at(-1)?.auth).toBe('Bearer synthetic-account-token')
  expect(await readFile(join(f.root, '.credentials.yaml'), 'utf8')).not.toContain('synthetic-password')
  expect(await f.ctx.deepseekAccount.resolveToken('https://api.deepseek.com/models')).toBeUndefined()
  expect(await f.ctx.deepseekAccount.getPlatformSession()).toBeNull()
  f.balance(0)
  expect(await f.ctx.deepseekAccount.getBalance({ version: 'test', locale: 'en', timezoneOffsetSeconds: 0 }))
    .toEqual({ status: 'ready', value: [{ balance: '0' }], bonusWallets: [] })
})

it('keeps authentication failures out of storage and permits retry', async () => {
  const f = await fixture()
  f.status(401)
  expect(await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'wrong'))
    .toMatchObject({ status: 'signed-out', attempt: { phase: 'failed', errorCode: 'invalid-credentials' } })
  expect(await f.ctx.credentials.readRecord(credentialKey('account-ximu', 'default'))).toBeUndefined()
  f.status(200)
  expect((await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'right')).status).toBe('credential-stored')
})

it('retains a login on balance errors and removes it after an authenticated 401', async () => {
  const f = await fixture()
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  f.status(503)
  expect(await f.ctx.deepseekAccount.getBalance({ version: 'test', locale: 'en', timezoneOffsetSeconds: 0 })).toEqual({ status: 'failed' })
  expect((await f.ctx.deepseekAccount.getState()).status).toBe('credential-stored')
  let expired = 0
  f.ctx.on('deepseek-account/session-expired', () => { expired++ })
  f.status(401)
  expect(await f.ctx.deepseekAccount.getBalance({ version: 'test', locale: 'en', timezoneOffsetSeconds: 0 })).toBeNull()
  expect((await f.ctx.deepseekAccount.getState()).status).toBe('signed-out')
  expect(expired).toBe(1)
})

it.each([{ access_token: '' }, { access_token: 'bad\ntoken' }, { code: 7, message: 'private diagnostics' }])(
  'refuses invalid or unsuccessful login responses', async (response) => {
    const f = await fixture()
    f.loginResponse(response)
    expect(await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password'))
      .toMatchObject({ status: 'signed-out', attempt: { phase: 'failed', errorCode: 'protocol' } })
  },
)

it('cancels a pending login before sign-out completes and prevents a late commit', async () => {
  const f = await fixture()
  const release = Promise.withResolvers<undefined>()
  f.hold(release.promise)
  try {
    const login = f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
    await f.requested
    expect((await f.ctx.deepseekAccount.signOut({ version: 'test', locale: 'en', timezoneOffsetSeconds: 0 })).status).toBe('signed-out')
    await login
    expect(await f.ctx.credentials.readRecord(credentialKey('account-ximu', 'default'))).toBeUndefined()
  } finally { release.resolve(undefined) }
})

it.each(['http://example.com/api', 'https://user:pass@example.com/api', 'https://example.com/api?x=1', 'https://example.com/api#x'])(
  'refuses unsafe management URL %s', (baseURL) => {
    expect(() => new XimuAccount(new Context(), { baseURL })).toThrow('baseURL must use HTTPS')
  },
)

it('returns signed-out details and no Platform-only capabilities before login', async () => {
  const f = await fixture()
  const api = f.ctx.deepseekAccount
  expect(await api.startSignIn(client, 'http://localhost:1', 'desktop')).toMatchObject({ status: 'signed-out' })
  expect(await api.getProfile(client)).toBeNull()
  expect(await api.getBalance(client)).toBeNull()
  expect(await api.getUnnotifiedBonuses(client)).toBeNull()
  expect(await api.getDeviceIdentity()).toHaveProperty('osVersion')
  expect(await api.ackBonusNotified('account' as AccountUserId, 'order' as AccountBonusOrderId, client)).toBe(false)
  await api.rejectToken('unrelated')
  await api.signOut(client)
  await f.ctx.credentials.modifyRecord(credentialKey('other', 'default'), async () => ({ kind: 'grant', payload: {} }))
})

it.each([['not-an-email', 'password'], ['test@example.com', ''], ['test@example.com', 'x'.repeat(4097)]])(
  'rejects invalid form input without a request', async (email, password) => {
    const f = await fixture()
    await expect(f.ctx.deepseekAccount.signInWithPassword(email, password)).rejects.toThrow('invalid-credentials')
    expect(f.seen).toHaveLength(0)
  },
)

it('joins an active attempt and cancels only its own ID', async () => {
  const f = await fixture()
  const api = f.ctx.deepseekAccount
  const release = Promise.withResolvers<undefined>()
  f.hold(release.promise)
  try {
    const first = api.signInWithPassword('test@example.com', 'synthetic-password')
    await f.requested
    const second = api.signInWithPassword('test@example.com', 'synthetic-password')
    await api.cancelSignIn('other-attempt' as SignInAttemptId)
    expect(f.seen).toHaveLength(1)
    const id = (await api.getState()).attempt!.id
    await api.cancelSignIn(id)
    expect(await first).toMatchObject({ attempt: { phase: 'cancelled' } })
    expect(await second).toMatchObject({ attempt: { phase: 'cancelled' } })
    await api.cancelSignIn(id)
  } finally { release.resolve(undefined) }
})

it('streams complete states, wakes pending readers, and closes watches on provider disposal', async () => {
  const f = await fixture()
  const api = f.ctx.deepseekAccount
  const controller = new AbortController()
  const stream = api.watch(controller.signal)[Symbol.asyncIterator]()
  expect((await stream.next()).value).toMatchObject({ status: 'signed-out' })
  const next = stream.next()
  await api.signInWithPassword('test@example.com', 'synthetic-password')
  expect((await next).value).toHaveProperty('attempt')
  controller.abort()
  expect((await stream.next()).done).toBe(true)
  const stopped = new AbortController()
  stopped.abort()
  expect((await api.watch(stopped.signal)[Symbol.asyncIterator]().next()).done).toBe(true)
  const other = api.watch(new AbortController().signal)[Symbol.asyncIterator]()
  await other.next()
  const waiting = other.next()
  await f.provider.dispose()
  expect((await waiting).done).toBe(true)
  await expect(api.signInWithPassword('test@example.com', 'synthetic-password')).rejects.toThrow('protocol')
})

it('cancels in-flight login and account reads on disposal', async () => {
  const f = await fixture()
  const api = f.ctx.deepseekAccount
  const release = Promise.withResolvers<undefined>()
  f.hold(release.promise)
  try {
    const login = api.signInWithPassword('test@example.com', 'synthetic-password')
    await f.requested
    await f.provider.dispose()
    expect(await login).toMatchObject({ attempt: { phase: 'cancelled' } })
    expect(await api.getBalance(client)).toBeNull()
  } finally { release.resolve(undefined) }
})

it('waits for an admitted credential write on cancellation and disposal', async () => {
  const f = await fixture()
  const api = f.ctx.deepseekAccount
  const admitted = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const original = f.ctx.credentials.modifyRecord.bind(f.ctx.credentials)
  vi.spyOn(f.ctx.credentials, 'modifyRecord').mockImplementation(async (...args) => {
    admitted.resolve(undefined)
    await release.promise
    return original(...args)
  })
  try {
    const login = api.signInWithPassword('test@example.com', 'synthetic-password')
    await admitted.promise
    const cancel = api.cancelSignIn((await api.getState()).attempt!.id)
    const disposed = f.provider.dispose()
    release.resolve(undefined)
    expect(await login).toMatchObject({ status: 'credential-stored' })
    expect(await cancel).toMatchObject({ status: 'credential-stored' })
    await disposed
  } finally { release.resolve(undefined) }
})

it('serializes login after a shared pending sign-out', async () => {
  const f = await fixture()
  const api = f.ctx.deepseekAccount
  await api.signInWithPassword('test@example.com', 'synthetic-password')
  const deleting = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const original = f.ctx.credentials.deleteRecord.bind(f.ctx.credentials)
  vi.spyOn(f.ctx.credentials, 'deleteRecord').mockImplementation(async (record) => {
    deleting.resolve(undefined)
    await release.promise
    return original(record)
  })
  try {
    const signOut = api.signOut(client)
    await deleting.promise
    expect(api.signOut(client)).toBe(signOut)
    const login = api.signInWithPassword('test@example.com', 'synthetic-password')
    release.resolve(undefined)
    await signOut
    expect(await login).toMatchObject({ status: 'credential-stored' })
  } finally { release.resolve(undefined) }
})

it('reports storage failure without replacing it with successful login', async () => {
  const f = await fixture()
  vi.spyOn(f.ctx.credentials, 'modifyRecord').mockRejectedValue(new Error('private storage diagnostic'))
  const state = await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  expect(state).toMatchObject({ status: 'signed-out', attempt: { errorCode: 'storage' } })
  expect(JSON.stringify(state)).not.toContain('private storage diagnostic')
})

it.each([
  () => new Response(null),
  () => new Response('invalid JSON'),
  () => new Response('x'.repeat(65_537)),
  () => new Response('{"code":0}'),
  () => { const response = new Response('{}'); response.body!.getReader(); return response },
  () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('body failed')) } })),
])('rejects invalid or unreadable management responses', async (response) => {
  const f = await fixture()
  vi.stubGlobal('fetch', async () => response())
  expect(await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password'))
    .toMatchObject({ status: 'signed-out', attempt: { errorCode: 'protocol' } })
})

it('distinguishes transport and server failures', async () => {
  const f = await fixture()
  vi.stubGlobal('fetch', async () => { throw new Error('private network diagnostic') })
  expect(await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password'))
    .toMatchObject({ attempt: { errorCode: 'no-response' } })
  vi.unstubAllGlobals()
  f.status(503)
  expect(await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password'))
    .toMatchObject({ attempt: { errorCode: 'network' } })
})

it('does not invent profile data or a zero balance from a malformed account response', async () => {
  const f = await fixture()
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  vi.stubGlobal('fetch', async () => new Response('{"email":"test@example.com","balance":"bad"}'))
  expect(await f.ctx.deepseekAccount.getProfile(client)).toEqual({ status: 'failed' })
  expect(await f.ctx.deepseekAccount.getBalance(client)).toEqual({ status: 'failed' })
})

it.each([{ kind: 'api-key' as const, key: 'synthetic-key' }, { kind: 'grant' as const, payload: {} },
  { kind: 'grant' as const, payload: { version: 1, issuer: 'https://other.example.com', token: 'synthetic-token' } }])(
  'refuses malformed or foreign stored records', async (record) => {
    const f = await fixture()
    await f.ctx.credentials.modifyRecord(key, async () => record)
    await expect(f.ctx.deepseekAccount.getState()).rejects.toThrow('storage')
  },
)

it.each([200, 401])('discards a response that arrives after sign-out (status=%s)', async (status) => {
  const f = await fixture()
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  const release = Promise.withResolvers<undefined>()
  f.status(status)
  f.hold(release.promise)
  try {
    const balance = f.ctx.deepseekAccount.getBalance(client)
    await f.detailRequested
    await f.ctx.deepseekAccount.signOut(client)
    release.resolve(undefined)
    expect(await balance).toBeNull()
  } finally { release.resolve(undefined) }
})


it('does not expire a credential removed during the rejection recheck', async () => {
  const f = await fixture()
  await f.ctx.deepseekAccount.signInWithPassword('test@example.com', 'synthetic-password')
  f.status(401)
  const rechecking = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const original = f.ctx.credentials.readRecord.bind(f.ctx.credentials)
  let reads = 0
  vi.spyOn(f.ctx.credentials, 'readRecord').mockImplementation(async (record) => {
    if (record === key && ++reads === 2) {
      rechecking.resolve(undefined)
      await release.promise
    }
    return original(record)
  })
  let expirations = 0
  f.ctx.on('deepseek-account/session-expired', () => { expirations++ })
  try {
    const balance = f.ctx.deepseekAccount.getBalance(client)
    await rechecking.promise
    await f.ctx.credentials.deleteRecord(key)
    release.resolve(undefined)
    expect(await balance).toBeNull()
    expect(expirations).toBe(0)
  } finally { release.resolve(undefined) }
})
