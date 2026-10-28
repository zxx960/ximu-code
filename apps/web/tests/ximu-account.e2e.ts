/** Shipped Web composition using the Desktop password provider and a real loopback management API. */
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold } from './scaffold.ts'

it('signs in, refreshes the recharge balance, restores the login, and signs out in both themes', async () => {
  let balance = 12.34
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.method === 'POST' && req.url === '/api/v1/auth/login') {
      let body = ''
      req.setEncoding('utf8')
      req.on('data', (chunk: string) => { body += chunk })
      req.on('end', () => {
        const input: unknown = JSON.parse(body)
        if (typeof input !== 'object' || input === null || !('email' in input) || !('password' in input)
          || input.email !== 'test@example.com' || input.password !== 'synthetic-password') {
          res.writeHead(401).end('{}')
          return
        }
        res.end(JSON.stringify({ code: 0, data: { access_token: 'synthetic-account-token' } }))
      })
    } else if (req.url === '/api/v1/auth/me' && req.headers.authorization === 'Bearer synthetic-account-token') {
      res.end(JSON.stringify({ email: 'test@example.com', balance }))
    } else res.writeHead(401).end('{}')
  })
  const root = await mkdtemp(join(tmpdir(), 'ximu-web-'))
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('missing account fixture listener')
    const overlay = join(root, 'account.overlay.yml')
    await writeFile(overlay, `- id: deepseek-account\n  disabled: true\n- id: ximu-account\n  disabled: false\n  config:\n    baseURL: http://127.0.0.1:${address.port}/api/v1\n    allowLoopbackHttp: true\n- id: ui-settings-account\n  config:\n    step: done\n    completion: completed\n`)
    scaffold = await launchWebScaffold({ extraOverlayPath: [join(import.meta.dirname, 'pin-browse-picker.overlay.yml'), overlay] })
    browser = await chromium.launch()
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, colorScheme, locale: 'en-US' })
      try {
        const page = await context.newPage()
        await page.goto(scaffold.authenticatedUrl)
        const menu = page.getByRole('button', { name: 'Account menu', exact: true })
        await menu.click()
        await page.getByRole('menuitem', { name: 'Sign in', exact: true }).click()
        const login = page.getByRole('dialog', { name: 'Sign in to Ximu', exact: true })
        await login.getByLabel('Email', { exact: true }).fill('test@example.com')
        await login.getByLabel('Password', { exact: true }).fill('synthetic-password')
        await login.getByRole('button', { name: 'Sign in', exact: true }).click()
        await login.waitFor({ state: 'detached' })
        await expect.poll(() => menu.textContent()).toBe('test@example.com')
        await page.reload()
        await expect.poll(() => menu.textContent()).toBe('test@example.com')
        await menu.click()
        await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
        const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
        const account = settings.getByRole('region', { name: 'Account', exact: true })
        await expect.poll(() => account.textContent()).toContain(balance.toFixed(2))
        expect(await account.getByText('Granted balance', { exact: true }).count()).toBe(0)
        expect(await account.getByRole('link', { name: 'Top up', exact: true }).count()).toBe(0)
        balance += 1
        await account.getByRole('button', { name: 'Refresh balance', exact: true }).click()
        await expect.poll(() => account.textContent()).toContain(balance.toFixed(2))
        const shots = join(import.meta.dirname, '../../../.artifacts/ximu-account')
        await mkdir(shots, { recursive: true })
        await page.screenshot({ path: join(shots, `${colorScheme}.png`) })
        await settings.getByRole('button', { name: 'Close', exact: true }).click()
        await menu.click()
        await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
        await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click()
        await expect.poll(() => menu.textContent()).toBe('More')
      } finally { await context.close() }
    }
  } finally {
    await browser?.close()
    await scaffold?.close()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() })
    await rm(root, { recursive: true, force: true })
  }
})
