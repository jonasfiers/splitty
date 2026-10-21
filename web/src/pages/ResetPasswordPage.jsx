import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import client from '../api/client'

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async e => {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setError('')
    setLoading(true)
    try {
      await client.post('/auth/reset-password', { token, password })
      navigate('/login', { state: { notice: 'Password reset successfully. You can now sign in.' } })
    } catch (e) {
      setError(e.response?.data?.error || 'Token invalid or expired.')
    } finally {
      setLoading(false)
    }
  }

  if (!token) return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Invalid link</h2>
        <p style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 24 }}>This reset link is missing a token.</p>
        <p className="auth-footer"><Link to="/forgot-password">Request a new link</Link></p>
      </div>
    </div>
  )

  return (
    <div className="auth-page">
      <img src="/cat-avatar.svg" alt="cat-icon" className="app-login-logo-desktop" />
      <div className="auth-card">
        <img src="/cat-avatar.svg" alt="cat-icon" className="app-login-logo-app" />
        <h1>Split<span>ty</span></h1>
        <h2>Choose a new password</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>New password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="form-group">
            <label>Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Saving…' : 'Set new password'}
          </button>
        </form>
        <p className="auth-footer"><Link to="/login">Back to sign in</Link></p>
      </div>
    </div>
  )
}
