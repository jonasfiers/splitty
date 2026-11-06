import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import client from '../api/client'
import Loading from '../components/Loading.jsx'
import { Avatar } from '../components/Avatar.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'

export default function FriendsPage() {
  const { currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    client.get('/users')
      .then(r => {
        const all = r.data.users || []
        setUsers(all.filter(u => u.id !== currentUser?.id))
      })
      .finally(() => setLoading(false))
  }, [currentUser])

  if (loading) return <Loading />

  return (
    <>
      <PageHeader crumbs={[{ to: '/profile', label: 'Profile' }]} title="Friends" name="Friends" />

      {users.length === 0 ? (
        <div className="empty-state">
          <img src="/cat-empty.svg" alt="" />
          <p className="empty-state-title">No friends yet</p>
          <p className="empty-state-sub">People you share a group with appear here. Invite someone from a group's Members tab.</p>
        </div>
      ) : (
        <div className="friends-list">
          {users.map((u, i) => (
            <div key={u.id} className="friend-item">
              <Avatar name={u.name} size={40} colorIndex={u.avatarColor} emoji={u.avatarEmoji} />
              <div className="friend-info">
                <div className="friend-name">{u.name}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
