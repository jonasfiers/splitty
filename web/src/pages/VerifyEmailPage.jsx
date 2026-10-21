import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router'
import client from '../api/client'

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) {
      setStatus('invalid')
      return
    }
    const controller = new AbortController()
    client.get(`/auth/verify-email?token=${encodeURIComponent(token)}`, { signal: controller.signal })
      .then(() => setStatus('success'))
      .catch(err => {
        if (err.code !== 'ERR_CANCELED') setStatus('invalid')
      })
    return () => controller.abort()
  }, [])

  return (
    <div className="auth-page">
      <img src="/cat-avatar.svg" alt="cat-icon" className="app-login-logo-desktop" />
      <div className="auth-card">
        <img src="/cat-avatar.svg" alt="cat-icon" className="app-login-logo-app" />
        <h1>Split<span>ty</span></h1>
        {status === 'loading' && (
          <>
            <h2>Verifying…</h2>
            <p style={{ fontSize: 14, color: 'var(--text-3)' }}>Just a moment while we confirm your email.</p>
          </>
        )}
        {status === 'success' && (
          <>
            <h2>Email verified</h2>
            <p style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 24 }}>
              Your account is now active. You can sign in.
            </p>
            <Link to="/login" className="btn btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              Sign in
            </Link>
          </>
        )}
        {status === 'invalid' && (
          <>
            <h2>Link expired</h2>
            <p style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 24 }}>
              This verification link is invalid or has expired. Try signing in to request a new one.
            </p>
            <p className="auth-footer"><Link to="/login">Back to sign in</Link></p>
          </>
        )}
      </div>
    </div>
  )
}
