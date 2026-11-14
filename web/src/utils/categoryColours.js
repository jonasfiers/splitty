// Category colours. Every top-level category has one (stored as its key,
// e.g. "amber"); its subcategories share it, the icon tells them apart.
// The icon squares' colours are CSS (index.css, "Category colours"), tuned
// for each theme; the charts need values, so theirs are here.
// Keep the keys in step with CATEGORY_COLOURS in api/crudService.js.
export const CATEGORY_COLOURS = [
  { key: 'amber',  label: 'Amber',  fill: '#FDECD1', stroke: '#B45309' },
  { key: 'green',  label: 'Green',  fill: '#D1FAE5', stroke: '#047857' },
  { key: 'teal',   label: 'Teal',   fill: '#CCFBF1', stroke: '#0F766E' },
  { key: 'sky',    label: 'Sky',    fill: '#E0F2FE', stroke: '#0369A1' },
  { key: 'blue',   label: 'Blue',   fill: '#DBEAFE', stroke: '#1D4ED8' },
  { key: 'violet', label: 'Violet', fill: '#EDE9FE', stroke: '#6D28D9' },
  { key: 'pink',   label: 'Pink',   fill: '#FCE7F3', stroke: '#BE185D' },
  { key: 'slate',  label: 'Slate',  fill: '#E2E8F0', stroke: '#475569' },
]
const BY_KEY = Object.fromEntries(CATEGORY_COLOURS.map(c => [c.key, c]))

// Classes for an icon square in a category's colour ('' for none: it keeps
// the accent colour, as trips, groups and settlements do).
export const tintClass = key => (BY_KEY[key] ? `tinted tint-${key}` : '')

// A chart's colours for a category: { fill, stroke }, or the neutral grey.
// shade 0, 1, 2… gives deeper fills of the same colour, for the slices of
// one category's subcategories (which share its colour).
const NEUTRAL = { fill: 'var(--surface-2)', stroke: 'var(--text-3)' }
const mix = (a, b, t) => '#' + [1, 3, 5].map(i => {
  const x = parseInt(a.slice(i, i + 2), 16), y = parseInt(b.slice(i, i + 2), 16)
  return Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
}).join('')
export const chartColour = (key, shade = 0) => {
  const c = BY_KEY[key]
  if (!c) return NEUTRAL
  return shade ? { fill: mix(c.fill, c.stroke, Math.min(shade * 0.22, 0.66)), stroke: c.stroke } : c
}
