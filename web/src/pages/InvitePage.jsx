import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router'
import client from '../api/client'
import { useAuth } from '../context/AuthContext'
import EmptyState from '../components/EmptyState/EmptyState.jsx'

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
      navigate(`/groups/${data.groupId}`, { replace: true })
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to join group.')
      setJoining(false)
    }
  }

  if (notFound) return (
    <EmptyState art={false} className="invite-missing" title="Invite not found" action={<Link className="btn btn-primary" to="/groups">Go to app</Link>}>
      This link may have expired or already been used.
    </EmptyState>
  )

  return (
    <div className="invite-page">
      <div className="card invite-card">
        {group ? (
          <>
            <div className="invite-icon">{group.icon || '👥'}</div>
            <p className="invite-title">{group.title}</p>
            <p className="invite-sub">You've been invited to join this group</p>
            {error && <p className="error">{error}</p>}
            {currentUser ? (
              <button className="btn btn-primary btn-block" onClick={handleJoin} disabled={joining}>
                {joining ? 'Joining…' : 'Join group'}
              </button>
            ) : (
              <>
                <p className="sheet-intro">Sign in to continue</p>
                <Link to="/login" state={{ redirect: `/invite/${token}` }} className="btn btn-primary btn-block invite-signin">Sign in</Link>
                <Link to="/register" state={{ redirect: `/invite/${token}` }} className="btn btn-ghost btn-block">Create account</Link>
              </>
            )}
          </>
        ) : !error ? (
          <p className="invite-loading">Loading…</p>
        ) : (
          <p className="error">{error}</p>
        )}
      </div>
    </div>
  )
}