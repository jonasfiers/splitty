import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router'
import { startRegistration } from '@simplewebauthn/browser'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import Loading from '../components/Loading.jsx'
import client from '../api/client'
import { timeAgo } from '../utils/time.js'
import { formatCurrency } from '../utils/currency.js'
import { Avatar, PALETTE } from '../components/Avatar.jsx'
import EmojiPicker from '../components/EmojiPicker/EmojiPicker.jsx'
import { subscribeToPush, unsubscribeFromPush, isPushSubscribed, disablePushForLogout, forgetPushLocally } from '../utils/push.js'
import TabHeader from '../components/PageHeader/TabHeader.jsx'
import Sheet from '../components/Sheet/Sheet.jsx'

export default function ProfilePage() {
  const { currentUser, isAdmin, logout, updateToken } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()

  const [profile, setProfile] = useState(null)
  const [passkeys, setPasskeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [notifications, setNotifications] = useState(false)
  const [notifError, setNotifError] = useState('')

  // One "Edit profile" sheet for name, email, colour and emoji.
  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', email: '', avatarColor: null, avatarEmoji: null })
  const [editError, setEditError] = useState('')
  const [editMessage, setEditMessage] = useState('')
  const [editSaving, setEditSaving] = useState(false)

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
        setEditForm({ name: prof.name, email: prof.email, avatarColor: prof.avatarColor ?? null, avatarEmoji: prof.avatarEmoji ?? null })
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

  const openEdit = () => {
    setEditForm({ name: profile.name, email: profile.email, avatarColor: profile.avatarColor ?? null, avatarEmoji: profile.avatarEmoji ?? null })
    setEditError('')
    setEditMessage('')
    setShowEdit(true)
  }

  const handleEditProfile = async e => {
    e.preventDefault()
    setEditError('')
    setEditMessage('')
    setEditSaving(true)
    try {
      const { data } = await client.put(`/users/${currentUser.id}`, {
        name: editForm.name,
        email: editForm.email,
        avatarColor: editForm.avatarColor ?? undefined,
        avatarEmoji: editForm.avatarEmoji ?? null,
      })
      updateToken(data.token)
      await loadProfile()
      setShowEdit(false)
      setEditMessage(data.emailChangePending
        ? `Verification email sent to ${editForm.email}. Your email will update once confirmed.`
        : 'Profile updated.')
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
      setExporting(true)
      const response = await client.get('/dash/export', { responseType: 'blob', timeout: 120000 });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `splitty-export-${new Date().toISOString().slice(0, 10)}.zip`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 10000)
    } catch (err) {
      setError('Failed to export data.');
    } finally {
      setExporting(false)
    }
  };

  if (loading) return <Loading />

  const editAvatar = (
    <Avatar name={editForm.name || profile.name} size={56} colorIndex={editForm.avatarColor} emoji={editForm.avatarEmoji} />
  )

  return (
    <>
      <TabHeader title="Profile" avatar={false} />

      {/* Who you are */}
      <section className="set-card profile-id">
        <Avatar name={profile.name} size={60} colorIndex={profile.avatarColor} emoji={profile.avatarEmoji} />
        <div className="profile-id-text">
          <div className="profile-name">{profile.name}</div>
          <div className="profile-email">{profile.email}</div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={openEdit}>Edit</button>
      </section>
      {profile.pendingEmail && (
        <p className="set-note">
          Waiting for you to confirm <strong>{profile.pendingEmail}</strong>: check that inbox.
        </p>
      )}
      {editMessage && <p className="set-ok">{editMessage}</p>}

      <div className="profile-layout">
        <div className="profile-col">
          {/* Account */}
          <SetGroup label="Account">
            <SetRow label="Name" value={profile.name} onClick={openEdit} />
            <SetRow label="Email" value={profile.email} onClick={openEdit} />
            {profile.hasPassword && (
              <SetRow label="Password" value="••••••••" onClick={() => { setShowPasswordForm(true); setPasswordMessage(''); setPasswordError('') }} />
            )}
          </SetGroup>
          {passwordMessage && <p className="set-ok">{passwordMessage}</p>}

          {/* Passkeys */}
          <SetGroup label="Passkeys" hint="Sign in with Face ID, Touch ID or your phone's screen lock instead of a password.">
            {passkeys.map(p => (
              <div key={p.credentialId} className="set-row">
                <span className="set-row-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2L20 3M17 6l3 3M15 8l2 2" /></svg>
                </span>
                <span className="set-row-main">
                  <span className="set-row-label">{p.name || 'Passkey'}</span>
                  <span className="set-row-sub">
                    {p.createdAt ? `Added ${new Date(p.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Added before Nov 2026'}
                    {p.lastUsedAt && ` · used ${timeAgo(p.lastUsedAt)}`}
                  </span>
                </span>
                <button type="button" className="set-row-remove" onClick={() => handleDeletePasskey(p.credentialId)} aria-label={`Remove ${p.name || 'passkey'}`}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="set-row set-row-action" onClick={handleAddPasskey}>
              + Add a passkey
            </button>
          </SetGroup>
          {message && <p className="set-ok">{message}</p>}
          {error && <p className="error">{error}</p>}
        </div>

        <div className="profile-col">
          {/* People */}
          <SetGroup label="People">
            <SetRow label="Friends" sub="Everyone you share a group with" to="/friends" />
          </SetGroup>

          {/* Preferences */}
          <SetGroup label="Preferences">
            <div className="set-row">
              <span className="set-row-main"><span className="set-row-label">Notifications</span></span>
              <button
                className={`toggle${notifications ? ' on' : ''}`}
                onClick={handleNotificationsToggle}
                aria-label="Notifications"
                aria-pressed={notifications}
              />
            </div>
            <div className="set-row">
              <span className="set-row-main"><span className="set-row-label">Appearance</span></span>
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
          </SetGroup>
          {notifError && <p className="error">{notifError}</p>}

          {/* Your data */}
          <SetGroup label="Your data">
            <SetRow
              label={exporting ? 'Preparing your data…' : 'Download all my data'}
              sub="Account, groups, expenses, trips and your files, as a ZIP"
              onClick={exporting ? undefined : handleExportData}
              action
            />
            <SetRow label="Privacy" sub="What Splitty stores and why" to="/privacy" />
          </SetGroup>

          {isAdmin && (
            <SetGroup label="Admin">
              <SetRow label="Categories and currencies" to="/admin" />
            </SetGroup>
          )}
        </div>
      </div>

      <button type="button" className="btn btn-ghost profile-signout" onClick={handleSignOut}>Sign out</button>
      <button type="button" className="profile-delete" onClick={() => setShowDelete(true)}>Delete account…</button>

      {showEdit && (
        <Sheet title="Edit profile" onClose={() => setShowEdit(false)}>
          <form onSubmit={handleEditProfile}>
            <div className="edit-avatar">
              {editAvatar}
              <div className="edit-avatar-pick">
                <div className="edit-avatar-colors">
                  {PALETTE.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`edit-avatar-color${editForm.avatarColor === i ? ' on' : ''}`}
                      style={{ background: c.bg, '--ring': c.fg }}
                      onClick={() => setEditForm(f => ({ ...f, avatarColor: i }))}
                      aria-label={`Colour ${i + 1}`}
                      aria-pressed={editForm.avatarColor === i}
                    />
                  ))}
                </div>
                <div className="edit-avatar-emoji">
                  <EmojiPicker value={editForm.avatarEmoji} onChange={emoji => setEditForm(f => ({ ...f, avatarEmoji: emoji }))} />
                  {editForm.avatarEmoji && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditForm(f => ({ ...f, avatarEmoji: null }))}>No emoji</button>
                  )}
                </div>
              </div>
            </div>
            <div className="form-group">
              <label>Name</label>
              <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} required />
              <p className="form-hint">A new address only takes effect once you confirm it from that inbox.</p>
            </div>
            {editError && <p className="error">{editError}</p>}
            <div className="panel-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowEdit(false)}>Cancel</button>
              <button type="submit" className="btn btn-secondary" disabled={editSaving}>{editSaving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Sheet>
      )}

      {showDelete && (
        <DeleteAccountSheet
          email={profile.email}
          userId={currentUser.id}
          onClose={() => setShowDelete(false)}
          onDeleted={async () => {
            await forgetPushLocally().catch(() => {})
            logout()
            navigate('/login', { state: { notice: 'Your account has been deleted. A confirmation is on its way to your inbox.' } })
          }}
        />
      )}

      {showPasswordForm && (
        <Sheet title="Change password" onClose={() => { setShowPasswordForm(false); setPasswordError('') }}>
          <form onSubmit={handleChangePassword}>
            <div className="form-group">
              <label>Current password</label>
              <input type="password" autoComplete="current-password" value={passwordForm.currentPassword} onChange={e => setPasswordForm(f => ({ ...f, currentPassword: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label>New password</label>
              <input type="password" autoComplete="new-password" value={passwordForm.newPassword} onChange={e => setPasswordForm(f => ({ ...f, newPassword: e.target.value }))} minLength={8} required />
            </div>
            <div className="form-group">
              <label>Confirm new password</label>
              <input type="password" autoComplete="new-password" value={passwordForm.confirmPassword} onChange={e => setPasswordForm(f => ({ ...f, confirmPassword: e.target.value }))} required />
            </div>
            {passwordError && <p className="error">{passwordError}</p>}
            <div className="panel-actions">
              <button type="button" className="btn btn-ghost" onClick={() => { setShowPasswordForm(false); setPasswordError('') }}>Cancel</button>
              <button type="submit" className="btn btn-secondary" disabled={passwordSaving}>{passwordSaving ? 'Saving…' : 'Change password'}</button>
            </div>
          </form>
        </Sheet>
      )}
    </>
  )
}

// Deleting the account: what happens, any open balances, and the address
// typed out to confirm (the server checks it too).
function DeleteAccountSheet({ email, userId, onClose, onDeleted }) {
  const [open, setOpen] = useState(null) // groups with a balance, null while loading
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    client.get('/dash/groups')
      .then(r => setOpen((r.data.groups || [])
        .map(g => ({ id: g.id, title: g.title, iso: g.iso, balance: g.members?.find(m => m.id === userId)?.balance ?? 0 }))
        .filter(g => Math.abs(g.balance) >= 0.005)))
      .catch(() => setOpen([]))
  }, [userId])

  const matches = typed.trim().toLowerCase() === String(email).toLowerCase()

  const handleDelete = async e => {
    e.preventDefault()
    if (!matches || busy) return
    setBusy(true)
    setError('')
    try {
      await client.delete(`/users/${userId}`, { data: { confirmEmail: typed.trim() } })
      await onDeleted()
    } catch (err) {
      setError(err?.response?.data?.error || 'Deleting the account failed.')
      setBusy(false)
    }
  }

  return (
    <Sheet title="Delete your account" onClose={onClose}>
      <form onSubmit={handleDelete}>
        <ul className="delete-facts">
          <li>Your name, email address, password, passkeys, avatar and notification settings are deleted.</li>
          <li>What you added to groups shared with others (expenses, trip plans, notes, files) stays there as <strong>“Deleted user”</strong>, so their balances and plans stay correct.</li>
          <li>Groups where nobody else is left are deleted completely, with their trips and files.</li>
          <li>You are signed out on every device.</li>
          <li>This cannot be undone. Use “Download all my data” first if you want a copy.</li>
        </ul>
        {open && open.length > 0 && (
          <div className="delete-open">
            <div className="delete-open-title">You still have open balances</div>
            {open.map(g => (
              <div key={g.id} className="delete-open-row">
                <span>{g.title}</span>
                <span className={g.balance > 0 ? 'positive' : 'negative'}>
                  {g.balance > 0 ? 'owed to you ' : 'you owe '}{formatCurrency(Math.abs(g.balance), g.iso)}
                </span>
              </div>
            ))}
            <p>You can still delete your account; these balances stay in the groups as they are.</p>
          </div>
        )}
        <div className="form-group">
          <label>Type your email address to confirm</label>
          <input
            type="email"
            autoComplete="off"
            placeholder={email}
            value={typed}
            onChange={e => setTyped(e.target.value)}
          />
        </div>
        {error && <p className="error">{error}</p>}
        <div className="panel-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-danger delete-confirm" disabled={!matches || busy}>
            {busy ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

function SetGroup({ label, hint, children }) {
  return (
    <section className="set-group">
      <h2 className="set-group-label">{label}</h2>
      <div className="set-card">{children}</div>
      {hint && <p className="set-group-hint">{hint}</p>}
    </section>
  )
}

// A settings row: a link (`to`), a button (`onClick`), or plain text.
// `action` styles it as a command rather than a place to go.
function SetRow({ label, value, sub, to, onClick, action = false }) {
  const body = (
    <>
      <span className="set-row-main">
        <span className="set-row-label">{label}</span>
        {sub && <span className="set-row-sub">{sub}</span>}
      </span>
      {value && <span className="set-row-value">{value}</span>}
      {!action && (to || onClick) && (
        <svg className="set-row-chev" viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 6 15 12 9 18" /></svg>
      )}
    </>
  )
  if (to) return <Link to={to} className="set-row set-row-link">{body}</Link>
  if (onClick) return <button type="button" className={`set-row set-row-link${action ? ' set-row-action' : ''}`} onClick={onClick}>{body}</button>
  return <div className="set-row">{body}</div>
}

