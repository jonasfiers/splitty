import { useState, useEffect } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router'
import { useAuth } from '../context/AuthContext'
import client from '../api/client'

export default function VerifyEmailChangePage() {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState('loading')
  const { updateToken } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) {
      setStatus('invalid')
      return
    }
    const controller = new AbortController()
    client.get(`/auth/verify-email-change?token=${encodeURIComponent(token)}`, { signal: controller.signal })
      .then(res => {
        updateToken(res.data.token)
        setStatus('success')
        setTimeout(() => navigate('/profile'), 2000)
      })
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
            <p style={{ fontSize: 14, color: 'var(--text-3)' }}>Just a moment while we confirm your new email.</p>
          </>
        )}
        {status === 'success' && (
          <>
            <h2>Email updated</h2>
            <p style={{ fontSize: 14, color: 'var(--text-3)' }}>
              Your email address has been changed. Redirecting to your profile…
            </p>
          </>
        )}
        {status === 'invalid' && (
          <>
            <h2>Link expired</h2>
            <p style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 24 }}>
              This link is invalid or has expired. You can request a new one from your profile.
            </p>
            <p className="auth-footer"><Link to="/profile">Back to profile</Link></p>
          </>
        )}
      </div>
    </div>
  )
}
