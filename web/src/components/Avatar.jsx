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

export function Avatar({ name, size = 34, style, colorIndex, emoji }) {
  const { bg, fg } = colorIndex !== undefined && colorIndex !== null ? colorFor(colorIndex) : colorFor(name)
  return (
    <div
      className="member-av"
      style={{ width: size, height: size, fontSize: emoji ? size * 0.55 : size * 0.35, flexShrink: 0, background: bg, color: fg, ...style }}
    >
      {emoji || getInitials(name)}
    </div>
  )
}

// Overlapping avatars, the first one on top: each next one tucks under the
// one to its left (a later element would otherwise paint over the earlier).
export function AvatarStack({ members = [], max = 4 }) {
  const shown = members.slice(0, max)
  return (
    <div className="avatar-stack">
      {shown.map((m, i) => {
        const { bg, fg } = m.avatarColor !== undefined && m.avatarColor !== null
          ? colorFor(m.avatarColor)
          : colorFor(m.name)
        const display = m.avatarEmoji || getInitials(m.name)
        return (
          <div key={m.id ?? i} className="av" style={{ background: bg, color: fg, zIndex: shown.length - i }}>
            {display}
          </div>
        )
      })}
    </div>
  )
}
