// Category colours. Every top-level category has one (stored as its key,
// e.g. "amber"); its subcategories share it, the icon tells them apart.
// The icon squares' colours are CSS (index.css, "Category colours"), tuned
// for each theme; the charts need values, so theirs are here.
// Keep the keys in step with CATEGORY_COLOURS in api/crudService.js.
// fill/stroke: the charts in the light theme; dark: [background, line] of the
// dark theme's tint (the same as index.css), mixed below into a chart fill.
export const CATEGORY_COLOURS = [
  { key: 'amber',  label: 'Amber',  fill: '#FDECD1', stroke: '#B45309', dark: ['#3A2814', '#FCC57E'] },
  { key: 'green',  label: 'Green',  fill: '#D1FAE5', stroke: '#047857', dark: ['#14302A', '#6EE7B7'] },
  { key: 'teal',   label: 'Teal',   fill: '#CCFBF1', stroke: '#0F766E', dark: ['#11302C', '#5EEAD4'] },
  { key: 'sky',    label: 'Sky',    fill: '#E0F2FE', stroke: '#0369A1', dark: ['#132C38', '#7DD3FC'] },
  { key: 'blue',   label: 'Blue',   fill: '#DBEAFE', stroke: '#1D4ED8', dark: ['#16243A', '#93C5FD'] },
  { key: 'violet', label: 'Violet', fill: '#EDE9FE', stroke: '#6D28D9', dark: ['#271F3E', '#C4B5FD'] },
  { key: 'pink',   label: 'Pink',   fill: '#FCE7F3', stroke: '#BE185D', dark: ['#3A1A2A', '#F9A8D4'] },
  { key: 'slate',  label: 'Slate',  fill: '#E2E8F0', stroke: '#475569', dark: ['#262A31', '#CBD5E1'] },
]
const BY_KEY = Object.fromEntries(CATEGORY_COLOURS.map(c => [c.key, c]))

// Classes for an icon square in a category's colour ('' for none: it keeps
// the accent colour, as trips, groups and settlements do).
export const tintClass = key => (BY_KEY[key] ? `tinted tint-${key}` : '')

// A chart's colours for a category: { fill, stroke }, or the neutral grey.
// shade 0, 1, 2… gives deeper fills of the same colour, for the slices of
// one category's subcategories (which share its colour). In the dark theme
// the fills are mid-tones of the dark tint: light pastels glare on brown.
// Charts call useTheme() so they redraw when the theme changes.
const NEUTRAL = { fill: 'var(--surface-2)', stroke: 'var(--text-3)' }
const mix = (a, b, t) => '#' + [1, 3, 5].map(i => {
  const x = parseInt(a.slice(i, i + 2), 16), y = parseInt(b.slice(i, i + 2), 16)
  return Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
}).join('')
const isDark = () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'
export const chartColour = (key, shade = 0) => {
  const c = BY_KEY[key]
  if (!c) return NEUTRAL
  if (isDark()) {
    const [bg, fg] = c.dark
    return { fill: mix(bg, fg, Math.min(0.38 + shade * 0.16, 0.8)), stroke: fg }
  }
  return { fill: shade ? mix(c.fill, c.stroke, Math.min(shade * 0.22, 0.66)) : c.fill, stroke: c.stroke }
}

// Settlements and balance transfers aren't a category: a solid tile in the
// text colour (dark on light, light on dark), next to the categories' colours
// without looking like one of them. The icon (handshake, arrows) tells them apart.
export const MONEY_TILE = { background: 'var(--text)', color: 'var(--surface)' }
