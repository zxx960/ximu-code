/** Native account access reuses authenticated Web RPC without a model-key login path. */
import { describe, expect, it, vi } from 'vitest'
import { connectDesktopWelcome } from '../src/welcome-backend.ts'

function transport(preference?: string) {
  const send = vi.fn<Parameters<typeof connectDesktopWelcome>[1]>(async (_input, init) => {
    if (init?.method !== 'POST') return new Response('index')
    const { rpcId, method } = JSON.parse(init.body as string) as { rpcId: string; method: string }
    let value: unknown
    if (method === 'account/getState') value = { links: { usageUrl: 'https://example.com', topUpUrl: 'https://example.com' },
      status: 'signed-out', attempt: null }
    else if (method === 'settings/describe') value = { namespaces: [{ ns: 'locale', value: preference === undefined ? {} : { preference } }] }
    else if (method === 'productAnalytics/enabled') value = true
    return Response.json({ type: 'server-response', rpcId, result: { ok: true, value } })
  })
  return { send }
}
const url = 'http://127.0.0.1:19387/?token=fixture'

describe('desktop welcome account operations', () => {
  it('authenticates through Web and reads only account state and locale', async () => {
    const host = transport('zh')
    const backend = await connectDesktopWelcome(url, host.send)
    expect(host.send).toHaveBeenCalledExactlyOnceWith(url, { credentials: 'include' })
    expect(await backend.read()).toEqual({ loggedIn: false, localePreference: 'zh' })
    expect(host.send.mock.calls.slice(1).map(([input]) => new URL(input).pathname).sort())
      .toEqual(['/api/account/getState', '/api/settings/describe'])
    expect(backend).not.toHaveProperty('save')
    for (const [, init] of host.send.mock.calls.slice(1)) expect(init).toMatchObject({ credentials: 'include', redirect: 'error' })
  })
  it('reads language without querying account or model providers', async () => {
    const host = transport()
    const backend = await connectDesktopWelcome(url, host.send)
    host.send.mockClear()
    expect(await backend.readLocalePreference()).toBeNull()
    expect(host.send).toHaveBeenCalledOnce()
    expect(host.send.mock.calls[0]![0]).toContain('/api/settings/describe')
  })
  it('rejects unmatched RPC envelopes', async () => {
    const host = transport()
    const backend = await connectDesktopWelcome(url, host.send)
    host.send.mockResolvedValueOnce(Response.json({ type: 'server-response', rpcId: 'other', result: { ok: true } }))
    await expect(backend.read()).rejects.toThrow('Web RPC failed')
  })
  it('submits native analytics through authenticated RPC with a bounded request', async () => {
    const host = transport()
    const backend = await connectDesktopWelcome(url, host.send)
    expect(await backend.analyticsEnabled()).toBe(true)
    const event = { eventName: 'desktop_app_launch' as const, timestamp: 100, attributes: {} }
    await backend.report(event)
    const [input, init] = host.send.mock.calls.at(-1)!
    expect(input).toBe('http://127.0.0.1:19387/api/productAnalytics/report')
    expect(init?.credentials).toBe('include')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init!.body as string)).toMatchObject({ payload: { args: { event } } })
  })
  it('refuses an unauthenticated Web launch', async () => {
    const send = vi.fn<Parameters<typeof connectDesktopWelcome>[1]>(async () => new Response(null, { status: 401 }))
    await expect(connectDesktopWelcome(url, send)).rejects.toThrow('Web authentication failed')
  })
})
