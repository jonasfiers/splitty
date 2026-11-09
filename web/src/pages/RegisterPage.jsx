import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuth } from '../context/AuthContext'
import Field from '../components/Field/Field.jsx'

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
            <p className="auth-message auth-message-gap">
              We sent a verification link to <strong>{form.email}</strong>. Click it to activate your account. The link expires in 24 hours.
            </p>
            <p className="auth-footer"><Link to="/login" state={state}>Back to sign in</Link></p>
          </>
        ) : (
          <>
            <h2>Create your account</h2>
            <form onSubmit={handleSubmit}>
              <Field label="Name">
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  autoComplete="name"
                  required
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  autoComplete="email"
                  required
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  autoComplete="new-password"
                  required
                />
              </Field>
              {error && <p className="error">{error}</p>}
              <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
                {loading ? 'Creating account…' : 'Create account'}
              </button>
            </form>
            <p className="auth-footer">
              Already have an account? <Link to="/login">Sign in</Link>
            </p>
            <p className="auth-footer auth-privacy">
              By creating an account you agree to how Splitty handles your data: <Link to="/privacy">Privacy</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
