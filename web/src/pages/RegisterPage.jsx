import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuth } from '../context/AuthContext'

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [verificationPending, setVerificationPending] = useState(false)
  const { register } = useAuth()
  const { state } = useLocation()

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    setLoading(true)
    try {
      await register(form.name, form.email, form.password)
      setVerificationPending(true)
    } catch (e) {
      if (e.response?.status === 429) {
        setError(e.response.data.error || 'Too many attempts. Please try again later.')
      } else {
        setError('Registration failed. Email may already be in use.')
      }
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
        {verificationPending ? (
          <>
            <h2>Check your inbox</h2>
            <p style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 24 }}>
              We sent a verification link to <strong>{form.email}</strong>. Click it to activate your account. The link expires in 24 hours.
            </p>
            <p className="auth-footer"><Link to="/login" state={state}>Back to sign in</Link></p>
          </>
        ) : (
          <>
            <h2>Create your account</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Name</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  autoComplete="name"
                  required
                />
              </div>
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
                <label>Password</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  autoComplete="new-password"
                  required
                />
              </div>
              {error && <p className="error">{error}</p>}
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? 'Creating account…' : 'Create account'}
              </button>
            </form>
            <p className="auth-footer">
              Already have an account? <Link to="/login">Sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
