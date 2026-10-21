import { useState } from 'react'
import { Link } from 'react-router'
import client from '../api/client'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await client.post('/auth/forgot-password', { email })
      setSubmitted(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <img src="/cat-avatar.svg" alt="cat-icon" className="app-login-logo-desktop" />
      <div className="auth-card">
        <img src="/cat-avatar.svg" alt="cat-icon" className="app-login-logo-app" />
        <h1>Split<span>ty</span></h1>
        {submitted ? (
          <>
            <h2>Check your inbox</h2>
            <p style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 24 }}>
              If that email is registered, a reset link has been sent. It expires in 1 hour.
            </p>
            <p className="auth-footer"><Link to="/login">Back to sign in</Link></p>
          </>
        ) : (
          <>
            <h2>Reset your password</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              {error && <p className="error">{error}</p>}
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <p className="auth-footer"><Link to="/login">Back to sign in</Link></p>
          </>
        )}
      </div>
    </div>
  )
}
