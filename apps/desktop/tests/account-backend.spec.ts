import { once } from 'node:events'
import { WebSocketServer } from 'ws'
import { expect, it, onTestFinished, vi } from 'vitest'
import { accountView, desktopAccountBackend } from '../src/account-backend.ts'

it('projects only safe password account fields', () => {
  const state = { links: { usageUrl: 'https://example.com', topUpUrl: 'https://example.com' },
    status: 'signed-out', token: 'private', attempt: { id: 'test', phase: 'initializing', password: 'private' } }
  expect(accountView(state)).toEqual({ links: state.links, status: 'signed-out', attempt: { id: 'test', phase: 'initializing' } })
  expect(() => accountView({ ...state, links: { usageUrl: 'file:///tmp/example', topUpUrl: 'https://example.com' } })).toThrow()
  expect(() => accountView({ ...state, attempt: { ...state.attempt, phase: 'waiting-browser' } })).toThrow()
  expect(() => accountView({ ...state, attempt: { ...state.attempt, errorCode: 'raw-server-message' } })).toThrow()
})

it('accepts a no-response login failure without discarding the account projection', () => {
  const state = { status: 'signed-out', attempt: { id: 'test', phase: 'failed', errorCode: 'no-response' },
    links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' } }
  expect(accountView(state)).toEqual(state)
})

it('uses account Remote commands without returning additional wire fields', async () => {
  const requests: unknown[] = []
  const backend = desktopAccountBackend('http://127.0.0.1:1234', (request) => {
    requests.push(request)
    return Promise.resolve({ links: { usageUrl: 'http://localhost/usage', topUpUrl: 'http://localhost/top_up' }, status: 'signed-out', attempt: null, token: 'private' })
  }, () => Promise.resolve(''))
  const client = { version: '1.2.3', locale: 'en', timezoneOffsetSeconds: 28_800 }
  expect(await backend.signInWithPassword('test@example.com', 'synthetic-password')).toEqual({ links: { usageUrl: 'http://localhost/usage', topUpUrl: 'http://localhost/top_up' }, status: 'signed-out', attempt: null })
  expect(await backend.signOut(client)).toMatchObject({ status: 'signed-out' })
  expect(requests).toEqual([
    { namespace: 'account', method: 'signInWithPassword', args: { email: 'test@example.com', password: 'synthetic-password' } },
    { namespace: 'account', method: 'signOut', args: { client } },
  ])
})

it('does not replay an expiry reason from an account snapshot', () => {
  const state = { status: 'signed-out', attempt: null,
    links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' } }
  expect(accountView({ ...state, signOutReason: 'expired' })).toEqual(state)
})

it('receives live expiry separately from account snapshots', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  onTestFinished(async () => {
    for (const client of server.clients) client.terminate()
    await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
  })
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('missing server address')
  const connected = once(server, 'connection')
  const expired = vi.fn()
  const onAnalyticsEnabledChanged = vi.fn()
  const snapshot = { status: 'signed-out', attempt: null,
    links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' } }
  const received = Promise.withResolvers<undefined>()
  const backend = desktopAccountBackend(`http://127.0.0.1:${address.port}`, () => Promise.resolve(snapshot), () => Promise.resolve(''))
  const stop = backend.watch(
    (value) => { expect(value).toEqual(snapshot); received.resolve(undefined) }, vi.fn(), expired, onAnalyticsEnabledChanged,
  )
  onTestFinished(stop)
  await connected
  // Logical streams share the socket; observe their opening frames before sending data.
  const streams = new Map<string, string>()
  const opened = Promise.withResolvers<undefined>()
  const socket = [...server.clients][0]!
  socket.on('message', (data) => {
    if (!Buffer.isBuffer(data)) throw new Error('expected a Buffer WebSocket frame')
    const frame = JSON.parse(data.toString('utf8')) as { endpoint: string; streamId: string }
    streams.set(frame.endpoint, frame.streamId)
    if (streams.size === 3) opened.resolve(undefined)
  })
  await opened.promise
  socket.send(JSON.stringify({ type: 'item', streamId: streams.get('account/watch'), value: snapshot }))
  await received.promise
  socket.send(JSON.stringify({ type: 'item', streamId: streams.get('productAnalytics/watchPolicy'), value: true }))
  await vi.waitFor(() => { expect(onAnalyticsEnabledChanged).toHaveBeenLastCalledWith(true) })
  socket.send(JSON.stringify({ type: 'item', streamId: streams.get('productAnalytics/watchPolicy'), value: false }))
  await vi.waitFor(() => { expect(onAnalyticsEnabledChanged).toHaveBeenLastCalledWith(false) })
  socket.send(JSON.stringify({ type: 'item', streamId: streams.get('productAnalytics/watchPolicy'), value: true }))
  await vi.waitFor(() => { expect(onAnalyticsEnabledChanged).toHaveBeenLastCalledWith(true) })
  socket.send(JSON.stringify({ type: 'item', streamId: streams.get('productAnalytics/watchPolicy'), value: 'invalid policy' }))
  await vi.waitFor(() => { expect(onAnalyticsEnabledChanged).toHaveBeenLastCalledWith(false) })
  expect(expired).not.toHaveBeenCalled()
  socket.send(JSON.stringify({ type: 'item', streamId: streams.get('account/watchExpiry'), value: 'session-expired' }))
  await vi.waitFor(() => { expect(expired).toHaveBeenCalledOnce() })
  stop()
})
