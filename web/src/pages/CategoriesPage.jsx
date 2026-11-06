import { useState, useEffect } from 'react'
import client from '../api/client'
import EmojiPicker from '../components/EmojiPicker/EmojiPicker.jsx'
import IconCard from '../components/IconCard/IconCard.jsx'
import Loading from '../components/Loading.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'

export default function CategoriesPage() {
  const [categories, setCategories] = useState([])
  const [form, setForm] = useState({ name: '', parentId: '', icon: '' })
  const [editId, setEditId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () =>
    client.get('/categories').then(r => setCategories(r.data.categories || []))

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [])

  const handleCreate = async e => {
    e.preventDefault()
    setError('')
    try {
      await client.post('/categories', form)
      await load()
      setForm({ name: '', parentId: '', icon: '' })
      setShowForm(false)
    } catch {
      setError('Failed to create category.')
    }
  }

  const startEdit = c => {
    setEditId(c.id)
    setEditForm({ name: c.name, parentId: c.parentId || '', icon: c.icon || '' })
  }

  const handleUpdate = async e => {
    e.preventDefault()
    setError('')
    try {
      await client.put(`/categories/${editId}`, editForm)
      await load()
      setEditId(null)
    } catch {
      setError('Failed to update category.')
    }
  }

  const handleDelete = async id => {
    if (!window.confirm('Delete this category?')) return
    setError('')
    try {
      await client.delete(`/categories/${id}`)
      setCategories(cs => cs.filter(c => c.id !== id))
    } catch {
      setError('Failed to delete category.')
    }
  }

  if (loading) return <Loading />

  return (
    <>
      <PageHeader
        crumbs={[{ to: '/admin', label: 'Admin' }]}
        title="Categories"
        name="Categories"
        aside={
          <button
            className="btn btn-secondary"
            onClick={() => { setShowForm(s => !s); setError('') }}
          >
            {showForm ? 'Cancel' : '+ New category'}
          </button>
        }
      />

      {showForm && (
        <div className="panel">
          <h3>New category</h3>
          <form onSubmit={handleCreate}>
            <div className="form-row form-row-compact" style={{ alignItems: 'end' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Icon</label>
                <EmojiPicker value={form.icon} onChange={icon => setForm(f => ({ ...f, icon }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Name</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Transport"
                  required
                />
              </div>
            </div>
            <div className="form-group" style={{ marginTop: 12 }}>
              <label>Parent category</label>
              <select
                value={form.parentId}
                onChange={e => setForm(f => ({ ...f, parentId: e.target.value }))}
              >
                <option value="">None (top-level)</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
            </div>
            {error && <p className="error">{error}</p>}
            <div className="panel-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn btn-secondary">Create</button>
            </div>
          </form>
        </div>
      )}

      {categories.length === 0 ? (
        <div className="empty"><p>No categories yet.</p></div>
      ) : (
        <div className="category-grid">
          {categories.map(c =>
            editId === c.id ? (
              <div key={c.id} className="card" style={{ padding: '16px' }}>
                <form onSubmit={handleUpdate}>
                  <div className="form-row form-row-compact" style={{ alignItems: 'end' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Icon</label>
                      <EmojiPicker value={editForm.icon} onChange={icon => setEditForm(f => ({ ...f, icon }))} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Name</label>
                      <input
                        value={editForm.name}
                        onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                        required
                      />
                    </div>
                  </div>
                  <div className="form-group" style={{ marginTop: 12 }}>
                    <label>Parent category</label>
                    <select
                      value={editForm.parentId}
                      onChange={e => setEditForm(f => ({ ...f, parentId: e.target.value }))}
                    >
                      <option value="">None (top-level)</option>
                      {categories.filter(cat => cat.id !== editId).map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.full_name}</option>
                      ))}
                    </select>
                  </div>
                  {error && <p className="error">{error}</p>}
                  <div className="panel-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}>Cancel</button>
                    <button type="submit" className="btn btn-secondary btn-sm">Save</button>
                  </div>
                </form>
              </div>
            ) : (
              <IconCard
                key={c.id}
                icon={c.icon || '🏷️'}
                title={c.full_name}
                actions={<>
                  <button className="btn btn-ghost btn-sm" onClick={() => startEdit(c)} title="Edit">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(c.id)} title="Delete">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      <path d="M10 11v6M14 11v6"/>
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                  </button>
                </>}
              />
            )
          )}
        </div>
      )}
    </>
  )
}