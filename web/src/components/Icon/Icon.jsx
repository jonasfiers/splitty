import { iconNode } from '../../utils/icons.js'

// One of the app's icons (utils/icons.js) by name, drawn in the text colour.
// Sized in em by default, so it takes the size of the text or box around it.
//
// name:     the icon, e.g. a category's stored icon ("utensils")
// fallback: drawn when `name` is empty or unknown (an old emoji value)
// label:    for an icon that means something on its own; otherwise it is
//           hidden from screen readers, as the text next to it says it
export default function Icon({ name, fallback, size = '1.2em', strokeWidth = 1.75, label, className = '', style }) {
  const node = iconNode(name) ?? iconNode(fallback)
  if (!node) return null
  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={style}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' })}
    >
      {node.map(([tag, attrs], i) => {
        const Tag = tag
        return <Tag key={i} {...attrs} />
      })}
    </svg>
  )
}

// For components that take an `icon` prop (ListRow, Picker options, IconCard):
// an icon's name becomes the icon; anything else (a letter, a symbol like
// "NT$", an Avatar) is shown as it is.
export const asIcon = icon => (typeof icon === 'string' && iconNode(icon) ? <Icon name={icon} /> : icon)
