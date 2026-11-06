import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import client from '../api/client'
import Loading from '../components/Loading.jsx'
import { Avatar } from '../components/Avatar.jsx'
import TabHeader from '../components/PageHeader/TabHeader.jsx'

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
      <TabHeader title="Friends" aside={<button className="btn-pill">+ Invite</button>} />

      {users.length === 0 ? (
        <div className="empty-state">
          <img src="/cat-empty.svg" alt="" />
          <p className="empty-state-title">No friends yet</p>
          <p className="empty-state-sub">Invite people to start splitting expenses together.</p>
          <button className="btn-pill">+ Invite a friend</button>
        </div>
      ) : (
        <div className="friends-list">
          {users.map((u, i) => (
            <div key={u.id} className="friend-item">
              <Avatar name={u.name} size={40} colorIndex={u.avatarColor} emoji={u.avatarEmoji} />
              <div className="friend-info">
                <div className="friend-name">{u.name}</div>
                <div className="friend-email">{u.email}</div>
              </div>
              <svg className="friend-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
