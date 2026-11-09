import { useState, useRef, useEffect, useCallback } from 'react'
import { browserSupportsWebAuthnAutofill, WebAuthnAbortService } from '@simplewebauthn/browser'
import { Link, useNavigate, useLocation } from 'react-router'
import { useAuth } from '../context/AuthContext'
import client from '../api/client'
import CatAvatar from '../components/CatAvatar/CatAvatar'

import { useOfflineDocs } from '../utils/useOfflineDocs.js'
import Field from '../components/Field/Field.jsx'

export default function LoginPage() {
  const offline = useOfflineDocs()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [unverified, setUnverified] = useState(false)
  const [resendStatus, setResendStatus] = useState(null)
  const [avatarState, setAvatarState] = useState(null)
  const avatarTimer = useRef(null)
  const { login, passkeyLogin } = useAuth()

  const triggerAvatar = (s, duration) => {
    clearTimeout(avatarTimer.current)
    setAvatarState(null)
    requestAnimationFrame(() => {
      setAvatarState(s)
      avatarTimer.current = setTimeout(() => setAvatarState(null), duration)
    })
  }
  const navigate = useNavigate()
  const { state } = useLocation()
  const redirect = state?.redirect || '/groups'

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    setUnverified(false)
    setResendStatus(null)
    setLoading(true)
    try {
      await login(form.email, form.password)
      triggerAvatar('success', 700)
      setTimeout(() => navigate(redirect), 650)
    } catch (e) {
      if (e.response?.status === 429) {
        setError(e.response.data.error || 'Too many attempts. Please try again later.')
      } else if (e.response?.data?.code === 'EMAIL_NOT_VERIFIED') {
        setUnverified(true)
      } else {
        setError('Invalid email or password.')
      }
      triggerAvatar('fail', 1300)
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResendStatus('sending')
    try {
      await client.post('/auth/resend-verification', { email: form.email })
      setResendStatus('sent')
    } catch {
      setResendStatus('error')
    }
  }

  // The passkey in the email field's suggestions. The request lives five
  // minutes on the server, so it is renewed a little before that while the
  // page is open; a new one cancels the previous one in the browser.
  const autofillRef = useRef(null)
  const startAutofill = useCallback(async () => {
    try {
      if (!(await browserSupportsWebAuthnAutofill())) return
      await passkeyLogin({ autofill: true })
      triggerAvatar('success', 700)
      setTimeout(() => navigate(redirect), 650)
    } catch (e) {
      // Cancelled (renewed, the button, leaving the page): nothing to tell.
      if (e?.name === 'AbortError' || e?.code === 'ERROR_CEREMONY_ABORTED') return
      if (e?.response) {
        setError('Passkey sign-in failed. Make sure you have a passkey registered for this device.')
        triggerAvatar('fail', 1300)
      }
    }
  }, [passkeyLogin, navigate, redirect])
  autofillRef.current = startAutofill
  useEffect(() => {
    autofillRef.current()
    const RENEW_MS = 4.5 * 60_000
    const timer = setInterval(() => { if (!document.hidden) autofillRef.current() }, RENEW_MS)
    return () => { clearInterval(timer); WebAuthnAbortService.cancelCeremony() }
  }, [])

  const handlePasskey = async () => {
    setError('')
    setLoading(true)
    try {
      await passkeyLogin()
      triggerAvatar('success', 700)
      setTimeout(() => navigate(redirect), 650)
    } catch (e) {
      if (e.response?.status === 429) {
        setError(e.response.data.error || 'Too many attempts. Please try again later.')
      } else {
        setError('Passkey sign-in failed. Make sure you have a passkey registered for this device.')
      }
      triggerAvatar('fail', 1300)
      setLoading(false)
      // The button's attempt cancelled the autofill one: offer it again.
      autofillRef.current()
    }
  }

  return (
    <div className="auth-page">
      <CatAvatar state={avatarState} className="app-login-logo-desktop" />
      <div className="auth-card">
        <CatAvatar state={avatarState} className="app-login-logo-app" />
        <h1>Split<span>ty</span></h1>
        <h2>Sign in to your account</h2>
        <form onSubmit={handleSubmit}>
          <Field label="Email">
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              // "webauthn": the browser may offer the passkey here, among its suggestions.
              autoComplete="username webauthn"
              required
            />
          </Field>
          <Field label="Password" aside={<Link to="/forgot-password" className="field-aside-link">Forgot password?</Link>}>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              autoComplete="current-password"
              required
            />
          </Field>
          {state?.notice && <p className="notice">{state.notice}</p>}
          {error && <p className="error">{error}</p>}
          {unverified && (
            <div className="error auth-unverified">
              <span>Please verify your email before signing in.</span>
              {resendStatus === 'sent' ? (
                <span className="auth-unverified-note">Verification email sent — check your inbox.</span>
              ) : (
                <button
                  type="button"
                  className="auth-unverified-resend"
                  onClick={handleResend}
                  disabled={resendStatus === 'sending'}
                >
                  {resendStatus === 'sending' ? 'Sending…' : 'Resend verification email'}
                </button>
              )}
              {resendStatus === 'error' && <span className="auth-unverified-note">Failed to send. Please try again.</span>}
            </div>
          )}
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="auth-divider">or</div>
        {/* Stays for browsers without passkey autofill, and for a passkey on
            another device (a phone's QR code). */}
        <button className="btn btn-ghost btn-block" onClick={handlePasskey} disabled={loading}>
          Sign in with passkey
        </button>
        <p className="auth-footer">
          No account? <Link to="/register">Register</Link>
        </p>
        {offline?.length > 0 && (
          <p className="auth-footer"><Link to="/offline-documents">Offline documents ({offline.length})</Link></p>
        )}
        <p className="auth-footer auth-privacy"><Link to="/privacy">Privacy</Link></p>
      </div>
    </div>
  )
}