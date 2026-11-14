import { useState, useEffect } from 'react'
import client from '../api/client'
import IconPicker from '../components/IconPicker/IconPicker.jsx'
import IconCard from '../components/IconCard/IconCard.jsx'
import Loading from '../components/Loading.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import { useConfirm } from '../components/Confirm/ConfirmProvider.jsx'
import Field from '../components/Field/Field.jsx'
import Picker from '../components/Picker/Picker.jsx'
import { iconOr } from '../utils/icons.js'

export default function CategoriesPage() {
  const confirm = useConfirm()
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
    if (!(await confirm({ title: 'Delete this category?', confirmLabel: 'Delete', danger: true }))) return
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
            className="btn btn-primary"
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
            <div className="form-row form-row-compact cat-form-row">
              <Field label="Icon">
                <IconPicker clearable value={form.icon} onChange={icon => setForm(f => ({ ...f, icon }))} />
              </Field>
              <Field label="Name">
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Transport"
                  required
                />
              </Field>
            </div>
            <Field label="Parent category" className="cat-parent">
              <Picker
                title="Parent category"
                value={form.parentId}
                onChange={v => setForm(f => ({ ...f, parentId: v }))}
                options={[{ value: '', label: 'None (top-level)' }, ...categories.map(c => ({ value: c.id, label: c.full_name, icon: c.icon }))]}
              />
            </Field>
            {error && <p className="error">{error}</p>}
            <div className="panel-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Create</button>
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
              <div key={c.id} className="card cat-edit-card">
                <form onSubmit={handleUpdate}>
                  <div className="form-row form-row-compact cat-form-row">
                    <Field label="Icon">
                      <IconPicker clearable value={editForm.icon} onChange={icon => setEditForm(f => ({ ...f, icon }))} />
                    </Field>
                    <Field label="Name">
                      <input
                        value={editForm.name}
                        onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                        required
                      />
                    </Field>
                  </div>
                  <Field label="Parent category" className="cat-parent">
                    <Picker
                      title="Parent category"
                      value={editForm.parentId}
                      onChange={v => setEditForm(f => ({ ...f, parentId: v }))}
                      options={[{ value: '', label: 'None (top-level)' }, ...categories.filter(cat => cat.id !== editId).map(cat => ({ value: cat.id, label: cat.full_name, icon: cat.icon }))]}
                    />
                  </Field>
                  {error && <p className="error">{error}</p>}
                  <div className="panel-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}>Cancel</button>
                    <button type="submit" className="btn btn-primary btn-sm">Save</button>
                  </div>
                </form>
              </div>
            ) : (
              <IconCard
                key={c.id}
                icon={iconOr(c.icon, 'tag')}
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