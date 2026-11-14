import { iconNode, countryOf, countryName, isIcon } from '../../utils/icons.js'

// One of the app's icons (utils/icons.js) by name, drawn in the text colour.
// Sized in em by default, so it takes the size of the text or box around it.
//
// name:     the icon, e.g. a category's stored icon ("utensils")
// fallback: drawn when `name` is empty or unknown (an old emoji value)
// A country ("country:TW") is drawn as its code, in the same box as an icon.
// label:    for an icon that means something on its own; otherwise it is
//           hidden from screen readers, as the text next to it says it
export default function Icon({ name, fallback, size = '1.2em', strokeWidth = 1.75, label, className = '', style }) {
  const shown = isIcon(name) ? name : fallback
  const country = countryOf(shown)
  const node = iconNode(shown)
  if (!node && !country) return null
  if (country) {
    return (
      <svg className={`icon icon-country ${className}`.trim()} width={size} height={size} viewBox="0 0 24 24" style={style}
        {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' })}>
        <title>{countryName(country)}</title>
        <text x="12" y="12.5" textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="800" fill="currentColor">{country}</text>
      </svg>
    )
  }
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
export const asIcon = icon => (typeof icon === 'string' && isIcon(icon) ? <Icon name={icon} /> : icon)
