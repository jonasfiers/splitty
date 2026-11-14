import { Link } from 'react-router'
import { asIcon } from '../Icon/Icon.jsx'

// One list style for the whole app: a card of rows.
//
// <List label="Account" hint="…">   optional heading above and hint below
//   <ListRow to="/x" icon="🍜" title="Dinner" meta="Paid by you · 6 Nov"
//            aside={<Amount/>} />
// </List>
//
// A row is a link (`to`), a button (`onClick`), or plain (neither), so it can
// be focused with the keyboard, is announced by screen readers, and a link
// can open in a new tab. Never an onClick on a div.
// className goes on the outermost element (the section when there is a label).
export function List({ label, hint, className = '', children }) {
  if (!label && !hint) return <div className={`list ${className}`.trim()}>{children}</div>
  const list = <div className="list">{children}</div>
  return (
    <section className={`list-section ${className}`.trim()}>
      {label && <h2 className="section-label">{label}</h2>}
      {list}
      {hint && <p className="list-hint">{hint}</p>}
    </section>
  )
}

// icon:    shown in the rounded square on the left (an icon's name, letter, node)
// title:   the main line;  meta: the grey line under it
// value:   plain grey text on the right (settings: "Name  Jonas")
// aside:   any node on the right (amounts)
// chevron: a › at the end, for rows that lead somewhere deeper
// action:  the row is a command ("Add passkey"): accent-coloured, no chevron
// end:     a button of its own at the end (Unlink, Delete): rendered next to
//          the row's link, not inside it (a button inside a link is invalid)
// href:    a plain <a> instead of a router link (files, external pages)
// children: extra lines under the meta
export function ListRow({
  to, href, onClick, end, state, icon, iconStyle, title, meta, value, aside, chevron = false, action = false,
  className = '', children, ...rest
}) {
  const body = (
    <>
      {icon != null && <span className="list-row-icon" style={iconStyle} aria-hidden="true">{asIcon(icon)}</span>}
      <span className="list-row-text">
        <span className="list-row-title">{title}</span>
        {meta && <span className="list-row-meta">{meta}</span>}
        {children}
      </span>
      {value != null && <span className="list-row-value">{value}</span>}
      {aside != null && <span className="list-row-aside">{aside}</span>}
      {chevron && !action && (
        <svg className="list-row-chev" viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 6 15 12 9 18" /></svg>
      )}
    </>
  )
  const cls = ['list-row', (to || href || onClick) && 'list-row-link', action && 'list-row-action', className].filter(Boolean).join(' ')
  const row = to ? <Link to={to} state={state} className={cls} onClick={onClick} {...rest}>{body}</Link>
    : href ? <a href={href} className={cls} onClick={onClick} {...rest}>{body}</a>
    : onClick ? <button type="button" className={cls} onClick={onClick} {...rest}>{body}</button>
    : <div className={cls} {...rest}>{body}</div>
  if (!end) return row
  return <div className="list-row-wrap">{row}{end}</div>
}
