import { colorFor, getInitials } from '../utils/avatar.js'

export { PALETTE, colorFor, getInitials } from '../utils/avatar.js'

export function Avatar({ name, size = 34, style, colorIndex }) {
  const { bg, fg } = colorIndex !== undefined && colorIndex !== null ? colorFor(colorIndex) : colorFor(name)
  return (
    <div
      className="member-av"
      style={{ width: size, height: size, fontSize: size * 0.35, flexShrink: 0, background: bg, color: fg, ...style }}
    >
      {getInitials(name)}
    </div>
  )
}

// Overlapping avatars, the first one on top: each next one tucks under the
// one to its left (a later element would otherwise paint over the earlier).
// More members than `max`: the last slot becomes "+N", so the stack never
// hides that the group is bigger (nor, sorted last, the user themselves).
export function AvatarStack({ members = [], max = 4 }) {
  const overflow = members.length > max
  const shown = members.slice(0, overflow ? max - 1 : max)
  const rest = members.length - shown.length
  const slots = shown.length + (overflow ? 1 : 0)
  return (
    <div className="avatar-stack" aria-label={`${members.length} member${members.length !== 1 ? 's' : ''}`}>
      {shown.map((m, i) => {
        const { bg, fg } = m.avatarColor !== undefined && m.avatarColor !== null
          ? colorFor(m.avatarColor)
          : colorFor(m.name)
        return (
          <div key={m.id ?? i} className="av" style={{ background: bg, color: fg, zIndex: slots - i }}>
            {getInitials(m.name)}
          </div>
        )
      })}
      {overflow && (
        <div className="av av-more" style={{ zIndex: slots - shown.length }} title={members.slice(shown.length).map(m => m.name).join(', ')}>
          +{rest}
        </div>
      )}
    </div>
  )
}
