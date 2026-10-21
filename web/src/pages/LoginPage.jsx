import { useState, useRef } from 'react'
import { Link, useNavigate, useLocation } from 'react-router'
import { useAuth } from '../context/AuthContext'
import client from '../api/client'
import CatAvatar from '../components/CatAvatar/CatAvatar'

export default function LoginPage() {
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

  const handlePasskey = async () => {
    setError('')
    setLoading(true)
    try {
      await passkeyLogin(form.email || undefined)
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
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              autoComplete="email"
              required
            />
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', justifyContent: 'space-between' }}>
              Password
              <Link to="/forgot-password" style={{ fontWeight: 400, fontSize: 12 }}>Forgot password?</Link>
            </label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              autoComplete="current-password"
              required
            />
          </div>
          {state?.notice && <p className="error" style={{ background: 'var(--accent-light)', color: 'var(--accent)', borderColor: 'var(--accent-subtle)' }}>{state.notice}</p>}
          {error && <p className="error">{error}</p>}
          {unverified && (
            <div className="error" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span>Please verify your email before signing in.</span>
              {resendStatus === 'sent' ? (
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Verification email sent — check your inbox.</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '4px 0', fontSize: 13, height: 'auto' }}
                  onClick={handleResend}
                  disabled={resendStatus === 'sending'}
                >
                  {resendStatus === 'sending' ? 'Sending…' : 'Resend verification email'}
                </button>
              )}
              {resendStatus === 'error' && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Failed to send. Please try again.</span>}
            </div>
          )}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="auth-divider">or</div>
        <button className="btn btn-ghost" onClick={handlePasskey} disabled={loading} style={{ width: '100%' }}>
          Sign in with passkey
        </button>
        <p className="auth-footer">
          No account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  )
}