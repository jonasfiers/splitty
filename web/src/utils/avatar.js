// Avatar colours and initials, shared by the Avatar component and the service
// worker (sw.js draws the same avatar into a notification's picture).
export const PALETTE = [
  { bg: '#FDECD1', fg: '#B45309' },
  { bg: '#D1FAE5', fg: '#065F46' },
  { bg: '#DBEAFE', fg: '#1E40AF' },
  { bg: '#EDE9FE', fg: '#5B21B6' },
  { bg: '#FCE7F3', fg: '#9D174D' },
  { bg: '#FFE4E6', fg: '#9F1239' },
  { bg: '#CCFBF1', fg: '#0F766E' },
  { bg: '#FEF3C7', fg: '#92400E' },
]

export function colorFor(nameOrIndex = '') {
  if (typeof nameOrIndex === 'number' && Number.isFinite(nameOrIndex))
    return PALETTE[Math.abs(nameOrIndex) % PALETTE.length]
  const hash = String(nameOrIndex).split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return PALETTE[hash % PALETTE.length]
}

export function getInitials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
}
