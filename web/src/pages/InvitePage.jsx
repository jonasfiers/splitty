import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router'
import client from '../api/client'
import { useAuth } from '../context/AuthContext'

export default function InvitePage() {
  const { token } = useParams()
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [group, setGroup] = useState(null)
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(false)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    client.get(`/invites/${token}`)
      .then(res => setGroup(res.data.group))
      .catch(err => {
        if (err.response?.status === 404) setNotFound(true)
        else setError('Failed to load invite.')
      })
  }, [token])

  const handleJoin = async () => {
    setJoining(true)
    try {
      const { data } = await client.post(`/invites/${token}/redeem`)
      navigate(`/groups/${data.groupId}`)
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to join group.')
      setJoining(false)
    }
  }

  if (notFound) return (
    <div className="empty-state" style={{ paddingTop: 80 }}>
      <p className="empty-state-title">Invite not found</p>
      <p className="empty-state-sub">This link may have expired or already been used.</p>
      <Link className="btn-pill" to="/groups">Go to app</Link>
    </div>
  )

  return (
    <div style={{ maxWidth: 400, margin: '80px auto', padding: '0 24px' }}>
      <div className="card" style={{ textAlign: 'center', padding: '32px 24px' }}>
        {group ? (
          <>
            <div style={{ fontSize: 40, marginBottom: 12 }}>{group.icon || '👥'}</div>
            <p style={{ fontWeight: 600, fontSize: 18, marginBottom: 4 }}>{group.title}</p>
            <p style={{ color: 'var(--text-3)', fontSize: 14, marginBottom: 24 }}>You've been invited to join this group</p>
            {error && <p className="error">{error}</p>}
            {currentUser ? (
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleJoin} disabled={joining}>
                {joining ? 'Joining…' : 'Join group'}
              </button>
            ) : (
              <>
                <p style={{ color: 'var(--text-3)', fontSize: 13, marginBottom: 16 }}>Sign in to continue</p>
                <Link to="/login" state={{ redirect: `/invite/${token}` }} className="btn btn-primary" style={{ display: 'block', marginBottom: 8 }}>Sign in</Link>
                <Link to="/register" state={{ redirect: `/invite/${token}` }} className="btn btn-ghost" style={{ display: 'block' }}>Create account</Link>
              </>
            )}
          </>
        ) : !error ? (
          <p style={{ color: 'var(--text-3)' }}>Loading…</p>
        ) : (
          <p className="error">{error}</p>
        )}
      </div>
    </div>
  )
}