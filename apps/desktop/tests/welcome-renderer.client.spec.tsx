// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'
import { Welcome } from '../src/client/WelcomePage.tsx'
import { resolveDesktopLocale } from '../src/locale.ts'
import type { WelcomeNotice } from '../src/welcome-api.ts'

const signedOut: AccountView = { status: 'signed-out', attempt: null,
  links: { usageUrl: 'https://example.test/usage', topUpUrl: 'https://example.test/top_up' } }
afterEach(cleanup)
function mount(language = 'zh-CN', takeNotice = vi.fn<() => Promise<WelcomeNotice | undefined>>().mockResolvedValue(undefined)) {
  const stopAccount = vi.fn()
  const api = { ...resolveDesktopLocale(language), takeNotice,
    analytics: vi.fn(async (_event: string, _attributes: object) => {}), analyticsEnabled: async () => true,
    onAccountState: vi.fn((_listener: (state: AccountView) => void) => stopAccount),
    signInWithPassword: vi.fn(async (_email: string, _password: string): Promise<AccountView> => signedOut) }
  const view = render(<Welcome api={api} />)
  const open = () => { fireEvent.click(document.querySelector('#sign-in')!) }
  const fill = () => {
    fireEvent.change(screen.getByLabelText(api.messages.welcomeEmail), { target: { value: 'test@example.com' } })
    fireEvent.change(screen.getByLabelText(api.messages.welcomePassword), { target: { value: 'synthetic-password' } })
  }
  const submit = () => { fireEvent.submit(document.querySelector('#password-form')!) }
  return { api, stopAccount, open, fill, submit, unmount: view.unmount }
}
it.each(['zh-CN', 'en'])('renders %s account-only welcome and password form', async (language) => {
  const view = mount(language)
  expect(document.documentElement.lang).toBe(language)
  const copy = [document.title, document.querySelector('img')!.alt, document.getElementById('welcome-heading')!.textContent,
    document.getElementById('welcome-description')!.textContent, view.api.messages.welcomeSignIn, ''].join('\n')
  await expect(copy).toMatchFileSnapshot(`./expected/welcome/${language}.expected.txt`)
  expect(document.querySelector('#api-key, #skip-key, #auth-page')).toBeNull()
  view.open()
  expect(document.activeElement).toBe(screen.getByLabelText(view.api.messages.welcomeEmail))
  expect(screen.getByLabelText<HTMLInputElement>(view.api.messages.welcomePassword).type).toBe('password')
})
it('clears the password immediately and prevents concurrent submissions', async () => {
  const view = mount(); const pending = Promise.withResolvers<AccountView>()
  view.api.signInWithPassword.mockReturnValue(pending.promise)
  view.open(); view.fill(); view.submit(); view.submit()
  expect(view.api.signInWithPassword).toHaveBeenCalledExactlyOnceWith('test@example.com', 'synthetic-password')
  expect(screen.getByLabelText<HTMLInputElement>(view.api.messages.welcomePassword).value).toBe('')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: view.api.messages.welcomeBack }).disabled).toBe(true)
  await act(async () => { pending.resolve({ ...signedOut, status: 'credential-stored',
    attempt: { id: 'success' as NonNullable<AccountView['attempt']>['id'], phase: 'succeeded' } }) })
  expect(document.querySelector('#password-error')!.textContent).toBe('')
})
it.each(['invalid-credentials', 'protocol'] as const)('reports %s and permits retry', async (errorCode) => {
  const view = mount()
  view.api.signInWithPassword.mockResolvedValue({ ...signedOut,
    attempt: { id: 'failed' as NonNullable<AccountView['attempt']>['id'], phase: 'failed', errorCode } })
  view.open(); view.fill(); await act(async () => { view.submit() })
  expect(screen.getByRole('alert').textContent).toBe(errorCode === 'invalid-credentials'
    ? view.api.messages.welcomeInvalidCredentials : view.api.messages.welcomeAuthFailed)
  view.fill(); await act(async () => { view.submit() })
  expect(view.api.signInWithPassword).toHaveBeenCalledTimes(2)
})
it('reports IPC failure without retaining the secret', async () => {
  const view = mount(); view.api.signInWithPassword.mockRejectedValue(new Error('closed'))
  view.open(); view.fill(); await act(async () => { view.submit() })
  expect(screen.getByRole('alert').textContent).toBe(view.api.messages.welcomeAuthFailed)
  expect(screen.getByLabelText<HTMLInputElement>(view.api.messages.welcomePassword).value).toBe('')
})
it('clears the draft on return and restores focus', () => {
  const view = mount(); view.open(); view.fill()
  fireEvent.click(screen.getByRole('button', { name: view.api.messages.welcomeBack }))
  expect(document.activeElement).toBe(document.querySelector('#sign-in'))
  view.open(); expect(screen.getByLabelText<HTMLInputElement>(view.api.messages.welcomePassword).value).toBe('')
})
it.each(['zh-CN', 'en'])('consumes the %s expiry notice once', async (language) => {
  vi.useFakeTimers()
  try {
    const notice = vi.fn<() => Promise<WelcomeNotice | undefined>>().mockResolvedValue(undefined).mockResolvedValueOnce('session-expired')
    const view = mount(language, notice); await act(async () => {})
    await expect(`${screen.getByRole('alert').textContent}\n`).toMatchFileSnapshot(`./expected/welcome/${language}-expired.expected.txt`)
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    await act(async () => { view.api.onAccountState.mock.calls[0]![0](signedOut) })
    expect(screen.queryByRole('alert')).toBeNull()
    view.unmount(); expect(view.stopAccount).toHaveBeenCalledOnce()
  } finally { cleanup(); vi.useRealTimers() }
})
it('ignores pending results after renderer disposal', async () => {
  const pending = Promise.withResolvers<AccountView>(); const view = mount()
  view.api.signInWithPassword.mockReturnValue(pending.promise)
  view.open(); view.fill(); view.submit(); view.unmount(); mount('en')
  await act(async () => { pending.resolve(signedOut) })
  expect(screen.queryByRole('alert')).toBeNull(); expect(view.stopAccount).toHaveBeenCalledOnce()
})
