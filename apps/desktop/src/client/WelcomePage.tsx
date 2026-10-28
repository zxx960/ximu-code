/** Desktop welcome and password sign-in; account credentials stay behind the preload API. */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives/src/Toast.tsx'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives/src/StateDot.tsx'
import type { WelcomeApi } from '../welcome-api.ts'

/**
 * Render the welcome entry and email/password form.
 * @param props.api - isolated preload operations and localized copy.
 * @returns the desktop sign-in surface.
 */
export function Welcome({ api }: { api: WelcomeApi }) {
  const { messages: m } = api
  const [formVisible, setFormVisible] = useState(false)
  const [expiryNotice, setExpiryNotice] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mounted = useRef(true)
  const emailInput = useRef<HTMLInputElement>(null)
  const signInButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    mounted.current = true
    document.documentElement.lang = api.id
    document.title = m.welcomeTitle
    const takeNotice = (): void => {
      void api.takeNotice().then((notice) => {
        if (mounted.current && notice === 'session-expired') setExpiryNotice(true)
      }).catch((_closedChannel: unknown) => {
        // The native window may close before its pending notice request settles.
      })
    }
    takeNotice()
    const stop = api.onAccountState(takeNotice)
    return () => { mounted.current = false; stop() }
  }, [api, m.welcomeTitle])

  useEffect(() => {
    if (formVisible) emailInput.current?.focus()
    else signInButton.current?.focus()
  }, [formVisible])

  async function signIn(event: FormEvent) {
    event.preventDefault()
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    const secret = password
    setPassword('')
    try {
      const state = await api.signInWithPassword(email.trim(), secret)
      if (mounted.current && state.attempt?.phase !== 'succeeded') {
        setError(state.attempt?.errorCode === 'invalid-credentials' ? m.welcomeInvalidCredentials : m.welcomeAuthFailed)
      }
    } catch {
      if (mounted.current) setError(m.welcomeAuthFailed)
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return <>
    {expiryNotice && <Toast text={m.welcomeSessionExpired} onDone={() => { setExpiryNotice(false) }} />}
    <div className="titlebar" aria-hidden="true" />
    <main className="welcome" aria-labelledby={formVisible ? 'password-title' : 'welcome-heading'}>
      <img className="brand" src="assets/welcome-brand.svg" alt={m.welcomeBrand} width="472" height="40" />
      <div className="tagline" hidden={formVisible}>
        <h1 id="welcome-heading"><span>{m.welcomeTaglineBefore}</span><em>{m.welcomeTaglineBrand}</em><span>{m.welcomeTaglineAfter}</span></h1>
        <p id="welcome-description">{m.welcomeDescription}</p>
      </div>
      <form id="password-form" className="password-form" hidden={!formVisible} onSubmit={(event) => { void signIn(event) }} aria-busy={busy}>
        <h1 id="password-title">{m.welcomePasswordTitle}</h1>
        <div className="password-fields">
          <label htmlFor="account-email">{m.welcomeEmail}</label>
          <input ref={emailInput} id="account-email" type="email" autoComplete="username" required maxLength={320} value={email} disabled={busy}
            onChange={(event) => { setEmail(event.target.value); setError('') }} />
          <label htmlFor="account-password">{m.welcomePassword}</label>
          <input id="account-password" type="password" autoComplete="current-password" required maxLength={4096} value={password} disabled={busy}
            aria-describedby="password-error" onChange={(event) => { setPassword(event.target.value); setError('') }} />
          <p id="password-error" className="password-error" role="alert" hidden={error === ''}>{error}</p>
        </div>
      </form>
      <div className="actions" hidden={formVisible}>
        <button ref={signInButton} id="sign-in" className="primary" type="button" onClick={() => {
          void api.analytics?.('auth_page_click', { button_name: 'sign_in' })
          setFormVisible(true)
        }}>{m.welcomeSignIn}</button>
      </div>
      <div className="actions" hidden={!formVisible}>
        <button id="submit-sign-in" className="primary" type="submit" form="password-form" disabled={busy || email.trim() === '' || password === ''}
          aria-label={m.welcomeSignIn}>
          {busy ? <StateDot state="ongoing" size={16} className="welcome-loading" /> : m.welcomeSignIn}
        </button>
        <button className="secondary" type="button" disabled={busy} onClick={() => {
          if (busyRef.current) return
          setPassword(''); setError(''); setFormVisible(false)
          void api.analytics?.('auth_page_view', {})
        }}>{m.welcomeBack}</button>
      </div>
    </main>
  </>
}
