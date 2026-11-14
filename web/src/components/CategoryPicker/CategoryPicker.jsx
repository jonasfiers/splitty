import Picker from '../Picker/Picker.jsx'

// A category from the user's list, in the shared picker sheet: grouped under
// their parent ("Eat out" › Restaurant, Bar…), searchable. Only the leaves
// can be picked; a parent with children is a heading.
//
// id: for a <Field> label; the trigger is then read as "Category, Eat out".
export default function CategoryPicker({ value, onChange, categories, nullable = true, id, placeholder = 'None' }) {
  const byId = new Map(categories.map(c => [c.id, c]))
  const parentIds = new Set(categories.map(c => c.parentId).filter(Boolean))
  const leaves = categories.filter(c => !parentIds.has(c.id))

  // The parent's full name as the section; categories without children or a
  // parent go last, under "Other".
  const section = c => (c.parentId ? byId.get(c.parentId)?.full_name ?? '' : '')
  const sorted = [...leaves].sort((a, b) =>
    (section(a) ? 0 : 1) - (section(b) ? 0 : 1) || section(a).localeCompare(section(b)) || (a.name ?? '').localeCompare(b.name ?? ''))

  // With a group's usage counts: its most used ones on top as well.
  const MOST_USED = 5
  const frequent = leaves.filter(c => c.usageCount > 0)
    .sort((a, b) => b.usageCount - a.usageCount).slice(0, MOST_USED)

  const options = [
    ...(nullable ? [{ value: '', label: 'None', icon: '—' }] : []),
    ...frequent.map(c => ({
      key: `most-${c.id}`, value: c.id, label: c.full_name, icon: c.icon, tint: c.colour,
      section: 'Used most in this group', hideWhenSearching: true,
    })),
    ...sorted.map(c => ({
      value: c.id,
      label: c.parentId ? (c.name ?? c.full_name) : c.full_name,
      short: c.full_name,
      icon: c.icon,
      tint: c.colour,
      section: section(c) || 'Other',
      keywords: c.full_name,
    })),
  ]

  return (
    <Picker
      id={id}
      title="Category"
      placeholder={placeholder}
      value={value ?? ''}
      onChange={v => onChange(v || null)}
      options={options}
    />
  )
}
