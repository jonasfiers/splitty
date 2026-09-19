import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { startRegistration } from '@simplewebauthn/browser'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import Loading from '../components/Loading.jsx'
import client from '../api/client'
import { formatCurrency } from '../utils/currency.js'
import { Avatar, PALETTE } from '../components/Avatar.jsx'
import EmojiPicker from '../components/EmojiPicker/EmojiPicker.jsx'
import { subscribeToPush, unsubscribeFromPush, isPushSubscribed, disablePushForLogout } from '../utils/push.js'

export default function ProfilePage() {
  const { currentUser, logout, updateToken } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()

  const [profile, setProfile] = useState(null)
  const [passkeys, setPasskeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [notifications, setNotifications] = useState(false)
  const [notifError, setNotifError] = useState('')

  const [showEditForm, setShowEditForm] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', email: '' })
  const [editError, setEditError] = useState('')
  const [editMessage, setEditMessage] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const [avatarColor, setAvatarColor] = useState(null)
  const [avatarEmoji, setAvatarEmoji] = useState(null)
  const [showAvatarEditor, setShowAvatarEditor] = useState(false)

  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [passwordError, setPasswordError] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)

  const loadProfile = () =>
    client.get('/dash/profile').then(r => {
      const prof = r.data.profile || null
      setProfile(prof)
      if (prof) {
        setEditForm({ name: prof.name, email: prof.email })
        setAvatarColor(prof.avatarColor ?? null)
        setAvatarEmoji(prof.avatarEmoji ?? null)
      }
      return prof
    })

  const loadPasskeys = () =>
    client.get('/auth/passkey/list').then(r => setPasskeys(r.data.passkeys || []))

  useEffect(() => {
    Promise.all([
      loadProfile(),
      client.get('/auth/passkey/list').then(r => r.data.passkeys || []),
    ]).then(([, pks]) => {
      setPasskeys(pks)
    }).finally(() => setLoading(false))

    isPushSubscribed().then(setNotifications)
  }, [currentUser])

  const handleEditProfile = async e => {
    e.preventDefault()
    setEditError('')
    setEditMessage('')
    setEditSaving(true)
    try {
      const { data } = await client.put(`/users/${currentUser.id}`, editForm)
      updateToken(data.token)
      await loadProfile()
      if (data.emailChangePending) {
        setEditMessage(`Verification email sent to ${editForm.email}. Your email will update once confirmed.`)
      } else {
        setEditMessage('Profile updated.')
        setShowEditForm(false)
      }
    } catch (err) {
      setEditError(err?.response?.data?.error || 'Failed to update profile.')
    } finally {
      setEditSaving(false)
    }
  }

  const handleChangePassword = async e => {
    e.preventDefault()
    setPasswordError('')
    setPasswordMessage('')
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('Passwords do not match.')
      return
    }
    setPasswordSaving(true)
    try {
      await client.post('/auth/change-password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      })
      setPasswordMessage('Password changed successfully.')
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setShowPasswordForm(false)
    } catch (err) {
      setPasswordError(err?.response?.data?.error || 'Failed to change password.')
    } finally {
      setPasswordSaving(false)
    }
  }

  const handleNotificationsToggle = async () => {
    setNotifError('')
    try {
      if (notifications) {
        await unsubscribeFromPush()
        setNotifications(false)
      } else {
        await subscribeToPush()
        setNotifications(true)
      }
    } catch (err) {
      console.error('[push]', err)
      setNotifError(err.message || String(err) || 'Unknown error')
    }
  }

  const handleAddPasskey = async () => {
    setError('')
    setMessage('')
    try {
      const { data: options } = await client.post('/auth/passkey/register/options')
      const registrationResponse = await startRegistration({ optionsJSON: options })
      await client.post('/auth/passkey/register/verify', registrationResponse)
      setMessage('Passkey registered successfully.')
      await loadPasskeys()
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to register passkey.')
    }
  }

  const handleDeletePasskey = async credentialId => {
    if (!window.confirm('Remove this passkey?')) return
    setError('')
    try {
      await client.delete(`/auth/passkey/${encodeURIComponent(credentialId)}`)
      setPasskeys(ps => ps.filter(p => p.credentialId !== credentialId))
    } catch { setError('Failed to remove passkey.') }
  }

  const handleSignOut = async () => {
    await disablePushForLogout().catch(() => {})
    logout()
    navigate('/login')
  }

  const handleExportData = async () => {
    try {
      const response = await client.get('/dash/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'splitty_export.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError('Failed to export data.');
    }
  };

  const handleSaveAvatar = async (newColor, newEmoji) => {
    try {
      const { data } = await client.put(`/users/${currentUser.id}`, {
        avatarColor: newColor,
        avatarEmoji: newEmoji ?? null,
      })
      updateToken(data.token)
    } catch {
      // silent — the UI already updated optimistically
    }
  }

  if (loading) return <Loading />

  return (
    <>
      {/* Hero */}
      <div className="profile-hero">
        <div
          className="profile-av-wrap"
          onClick={() => setShowAvatarEditor(v => !v)}
        >
          <Avatar
            name={profile.name}
            size={76}
            colorIndex={avatarColor}
            emoji={avatarEmoji}
            style={{ border: '3px solid var(--border)' }}
          />
          <div className="profile-av-edit-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </div>
        </div>
        <div className="profile-name">{profile.name}</div>
        <div className="profile-email">{profile.email}</div>
      </div>

      {showAvatarEditor && (
        <div className="panel" style={{ marginBottom: 16, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', marginBottom: 10, letterSpacing: '.06em', textTransform: 'uppercase' }}>Color</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {PALETTE.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { setAvatarColor(i); handleSaveAvatar(i, avatarEmoji) }}
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: p.bg,
                  border: avatarColor === i ? `3px solid ${p.fg}` : '2px solid var(--border)',
                  cursor: 'pointer', flexShrink: 0,
                }}
                aria-label={`Color ${i + 1}`}
              />
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', marginBottom: 10, letterSpacing: '.06em', textTransform: 'uppercase' }}>Emoji</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <EmojiPicker
              value={avatarEmoji}
              onChange={emoji => { setAvatarEmoji(emoji); handleSaveAvatar(avatarColor, emoji) }}
            />
            {avatarEmoji && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => { setAvatarEmoji(null); handleSaveAvatar(avatarColor, null) }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="stats-row">
        <div className="stat-col">
          <span className="stat-val">{profile.groupCount}</span>
          <span className="stat-lbl">Groups</span>
        </div>
        <div className="stat-div" />
        <div className="stat-col">
          <span className="stat-val">{profile.expenseCount}</span>
          <span className="stat-lbl">Expenses</span>
        </div>
        <div className="stat-div" />
        <div className="stat-col">
          <span className="stat-val" style={{ fontSize: 16 }}>{formatCurrency(profile.balance)}</span>
          <span className="stat-lbl">Net balance</span>
        </div>
      </div>

      {/* Edit Profile */}
      <div className="pref-section-label">Profile</div>

      {profile.pendingEmail && (
        <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 12px', padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8 }}>
          Verification pending for <strong style={{ color: 'var(--text-1)' }}>{profile.pendingEmail}</strong> — check your inbox.
        </p>
      )}

      {editMessage && !showEditForm && (
        <p style={{ fontSize: 13, color: 'var(--green-dark)', fontWeight: 600, margin: '0 0 12px' }}>{editMessage}</p>
      )}
      {passwordMessage && !showPasswordForm && (
        <p style={{ fontSize: 13, color: 'var(--green-dark)', fontWeight: 600, margin: '0 0 12px' }}>{passwordMessage}</p>
      )}

      {showEditForm ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <form onSubmit={handleEditProfile}>
            <div className="form-group">
              <label>Name</label>
              <input
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={editForm.email}
                onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                required
              />
              <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '4px 0 0' }}>
                Changing your email will send a verification link to the new address.
              </p>
            </div>
            {editError && <p className="error">{editError}</p>}
            {editMessage && <p style={{ fontSize: 13, color: 'var(--green-dark)', fontWeight: 600 }}>{editMessage}</p>}
            <div className="panel-actions">
              <button type="button" className="btn btn-ghost" onClick={() => { setShowEditForm(false); setEditError(''); setEditMessage('') }}>Cancel</button>
              <button type="submit" className="btn btn-secondary" disabled={editSaving}>{editSaving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      ) : (
        <div className="pref-row">
          <span className="pref-label">Name &amp; email</span>
          <button className="btn btn-ghost btn-sm" onClick={() => { setShowEditForm(true); setEditMessage(''); setEditError('') }}>Edit</button>
        </div>
      )}

      {profile.hasPassword && (
        showPasswordForm ? (
          <div className="panel" style={{ marginBottom: 12 }}>
            <form onSubmit={handleChangePassword}>
              <div className="form-group">
                <label>Current password</label>
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={e => setPasswordForm(f => ({ ...f, currentPassword: e.target.value }))}
                  required
                />
              </div>
              <div className="form-group">
                <label>New password</label>
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={e => setPasswordForm(f => ({ ...f, newPassword: e.target.value }))}
                  minLength={8}
                  required
                />
              </div>
              <div className="form-group">
                <label>Confirm new password</label>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={e => setPasswordForm(f => ({ ...f, confirmPassword: e.target.value }))}
                  required
                />
              </div>
              {passwordError && <p className="error">{passwordError}</p>}
              <div className="panel-actions">
                <button type="button" className="btn btn-ghost" onClick={() => { setShowPasswordForm(false); setPasswordError('') }}>Cancel</button>
                <button type="submit" className="btn btn-secondary" disabled={passwordSaving}>{passwordSaving ? 'Saving…' : 'Change password'}</button>
              </div>
            </form>
          </div>
        ) : (
          <div className="pref-row">
            <span className="pref-label">Password</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowPasswordForm(true); setPasswordMessage(''); setPasswordError('') }}>Change</button>
          </div>
        )
      )}

      {/* Preferences */}
      <div className="pref-section-label">Preferences</div>

      <div className="pref-row">
        <span className="pref-label">Notifications</span>
        <button
          className={`toggle${notifications ? ' on' : ''}`}
          onClick={handleNotificationsToggle}
          aria-label="Toggle notifications"
        />
      </div>
      {notifError && <p style={{ fontSize: 12, color: 'var(--red-dark)', margin: '-4px 0 8px' }}>{notifError}</p>}

      <div className="pref-row">
        <span className="pref-label">Appearance</span>
        <div className="theme-segment">
          {['system', 'light', 'dark'].map(opt => (
            <button
              key={opt}
              className={`theme-segment-btn${theme === opt ? ' active' : ''}`}
              onClick={() => setTheme(opt)}
            >
              {opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Data Management */}
      <div className="pref-section-label">Data Management</div>
      <div className="pref-row">
        <span className="pref-label">Export your data</span>
        <button className="btn-amber-pill" onClick={handleExportData} style={{ padding: '6px 16px' }}>CSV</button>
      </div>

      {/* Security */}
      <div className="pref-section-label">Security</div>

      {message && <p style={{ color: 'var(--green-dark)', fontSize: 13, fontWeight: 600, padding: '0 0 8px' }}>{message}</p>}
      {error && <p className="error" style={{ margin: '0 0 8px' }}>{error}</p>}

      <div className="passkey-list">
        {passkeys.length === 0 ? (
          <div className="passkey-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 10a4 4 0 1 0 4 4"/>
              <path d="M12 10V4"/>
              <path d="M12 4a2 2 0 0 1 4 0"/>
              <path d="M20 14a8 8 0 1 1-8-8"/>
            </svg>
            <p className="passkey-empty-title">No passkeys yet</p>
            <p className="passkey-empty-sub">Add one to sign in with Touch ID or Face ID.</p>
            <button className="btn-amber-pill" onClick={handleAddPasskey}>+ Add passkey</button>
          </div>
        ) : (
          <>
            {passkeys.map((p, i) => (
              <div key={p.credentialId} className="passkey-card">
                <div className="passkey-card-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 10a4 4 0 1 0 4 4"/>
                    <path d="M12 10V4"/>
                    <path d="M12 4a2 2 0 0 1 4 0"/>
                    <path d="M20 14a8 8 0 1 1-8-8"/>
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pref-label">Passkey {passkeys.length > 1 ? i + 1 : ''}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                    {p.credentialId.slice(0, 24)}…
                  </div>
                </div>
                <button className="passkey-remove-btn" onClick={() => handleDeletePasskey(p.credentialId)} title="Remove passkey">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              </div>
            ))}
            <button className="btn-outline-amber" style={{ width: '100%', marginTop: 8 }} onClick={handleAddPasskey}>+ Add passkey</button>
          </>
        )}
      </div>

      {/* Sign out */}
      <div style={{ paddingTop: 24 }}>
        <button className="btn btn-danger" onClick={handleSignOut}>Sign out</button>
      </div>
    </>
  )
}
