import { useState, useEffect, useCallback } from 'react'
import client from '../api/client'
import Loading from '../components/Loading.jsx'
import LoadFailed from '../components/LoadFailed.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import Field from '../components/Field/Field.jsx'
import { List, ListRow } from '../components/List/List.jsx'
import { Avatar } from '../components/Avatar.jsx'
import { useConfirm } from '../components/Confirm/ConfirmProvider.jsx'

// Who has the admin role. Granting needs the exact email address of a verified
// account (no browsing of users); the last admin can't be removed. The server
// enforces both (routes/admin.js).
export default function AdminsPage() {
  const confirm = useConfirm()
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [showForm, setShowForm] = useState(false)
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    client.get('/admin/admins')
      .then(r => setAdmins(r.data.admins || []))
      .catch(err => setLoadError(err))
      .finally(() => setLoading(false))
  }, [attempt])
  const retry = useCallback(() => { setLoadError(null); setLoading(true); setAttempt(n => n + 1) }, [])

  const grant = async e => {
    e.preventDefault()
    setError(''); setNotice('')
    setSaving(true)
    try {
      const { data } = await client.post('/admin/admins', { email })
      setAdmins(list => [...list, data.admin].sort((a, b) => a.name.localeCompare(b.name)))
      setNotice(`${data.admin.name} is now an admin.`)
      setEmail('')
      setShowForm(false)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to grant the admin role.')
    } finally {
      setSaving(false)
    }
  }

  const revoke = async a => {
    const ok = await confirm({
      title: a.you ? 'Remove your own admin role?' : `Remove ${a.name} as admin?`,
      message: a.you ? 'You lose access to this page at once.' : 'They lose access to the admin pages at once.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    setError(''); setNotice('')
    try {
      await client.delete(`/admin/admins/${a.id}`)
      if (a.you) { window.location.assign('/profile'); return }
      setAdmins(list => list.filter(x => x.id !== a.id))
      setNotice(`${a.name} is no longer an admin.`)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to remove the admin role.')
    }
  }

  const header = (
    <PageHeader
      crumbs={[{ to: '/admin', label: 'Admin' }]}
      title="Admins"
      name="Admins"
      aside={!loading && !loadError && (
        <button className="btn btn-primary" onClick={() => { setShowForm(s => !s); setError('') }}>
          {showForm ? 'Cancel' : '+ Add admin'}
        </button>
      )}
    />
  )
  if (loading) return <>{header}<Loading /></>
  if (loadError) return <>{header}<LoadFailed error={loadError} what="the admins" onRetry={retry} /></>

  const last = admins.length <= 1

  return (
    <>
      {header}
      <p className="admin-intro">Admins manage the shared categories and currencies, and who else is an admin.</p>

      {showForm && (
        <div className="panel">
          <h3>Add an admin</h3>
          <form onSubmit={grant}>
            <Field label="Email address of their account" hint="Their exact sign-in address. The account must have verified it.">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" required />
            </Field>
            {error && <p className="error">{error}</p>}
            <div className="panel-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Make admin'}</button>
            </div>
          </form>
        </div>
      )}

      {!showForm && error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <List label={`${admins.length} admin${admins.length === 1 ? '' : 's'}`}>
        {admins.map(a => (
          <ListRow
            key={a.id}
            icon={<Avatar name={a.name} size={36} />}
            className="list-row-person"
            title={a.you ? `${a.name} (you)` : a.name}
            meta={a.email}
            end={!last && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => revoke(a)}>Remove</button>
            )}
          />
        ))}
      </List>
      {last && <p className="field-note">Splitty needs at least one admin, so the last one can't be removed.</p>}
    </>
  )
}
