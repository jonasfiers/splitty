import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useMediaQuery } from '../../utils/useMediaQuery.js'
import BackLink from '../BackLink.jsx'
import './PageHeader.css'

// The header of a detail page (a trip, a group, an expense...).
//
// Desktop: a breadcrumb ("Trips › Taiwan"), then the title with the main
// action as a button and the rest in a ⋯ menu.
// Phone: an iOS-style bar that stays at the top ("‹ Trips", the main action,
// ⋯); the title below it is large, and once it scrolls away its name fades
// into the bar.
//
// crumbs:  [{ to, label }, ...]          the path to this page, top level first;
//          desktop shows them all as a breadcrumb, the phone bar's back link
//          goes to the last one
// back:    { to }                         instead of crumbs: a plain "‹ Back"
//          link (forms, where "back" is not a place in the hierarchy)
// title:   node shown as the title        (may include an emoji/flag)
// name:    plain text name                for the breadcrumb and the bar
// actions: [{ label, onClick, primary?, danger?, form?, disabled? }]
//          form: the id of a form the primary button submits (Save in the bar)
//          the first `primary` one is the button; the rest go in the menu
// children: the line(s) under the title (dates, counts...)
// compact: no large title (the page shows its own, e.g. in a card); the bar
//          always shows the name, and desktop shows only the breadcrumb row
// aside:   extra content at the end of the title row (both layouts)
//
export default function PageHeader({ crumbs, back: plainBack, title, name, actions = [], children, compact = false, aside = null }) {
  const wide = useMediaQuery('(min-width: 768px)')
  const primary = actions.find(a => a.primary)
  const rest = actions.filter(a => a !== primary)

  const titleRef = useRef(null)
  const [titleGone, setTitleGone] = useState(false)
  useEffect(() => {
    if (wide || compact || !titleRef.current || typeof IntersectionObserver === 'undefined') return
    const el = titleRef.current
    const root = el.closest('.app-content')
    const io = new IntersectionObserver(
      ([e]) => setTitleGone(!e.isIntersecting && e.boundingClientRect.top < (e.rootBounds?.top ?? 0) + 44),
      { root, rootMargin: '-44px 0px 0px 0px', threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [wide, compact])
  const barTitled = compact || titleGone
  const back = crumbs?.length ? crumbs[crumbs.length - 1] : plainBack
  const backLabel = crumbs?.length ? back.label : 'Back'

  const backLink = (
    <BackLink to={back.to} replace={!!plainBack && !crumbs?.length} className="ph-back">
      <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
      {backLabel}
    </BackLink>
  )

  if (wide) {
    return (
      <header className={`ph ph-wide${compact ? ' ph-compact' : ''}`}>
        {crumbs?.length ? (
          <nav className="ph-crumbs" aria-label="Breadcrumb">
            {crumbs.map(c => (
              <span key={c.to} className="ph-crumb">
                <Link to={c.to}>{c.label}</Link>
                <span className="ph-crumb-sep" aria-hidden="true">›</span>
              </span>
            ))}
            <span className="ph-crumb-current" aria-current="page">{name}</span>
          </nav>
        ) : <div className="ph-crumbs">{backLink}</div>}
        {(!compact || actions.length > 0 || aside) && (
          <div className="ph-head">
            {compact ? <span className="ph-spacer" /> : <h1 className="ph-title">{title}</h1>}
            {aside}
            {actions.length > 0 && (
              <div className="ph-actions">
                {primary && <button type={primary.form ? 'submit' : 'button'} form={primary.form} disabled={primary.disabled} className="btn btn-ghost ph-btn" onClick={primary.onClick}>{primary.label}</button>}
                <MoreMenu items={rest} />
              </div>
            )}
          </div>
        )}
        {children && <div className="ph-meta">{children}</div>}
      </header>
    )
  }

  return (
    // The bar is a sibling of the header, not inside it: a sticky element only
    // sticks within its parent, and the header is too short to hold it.
    <>
      <div className={`ph-bar${barTitled ? ' ph-bar-titled' : ''}${compact ? ' ph-bar-compact' : ''}`}>
        {backLink}
        <span className="ph-bar-name" aria-hidden={!barTitled}>{name}</span>
        <div className="ph-bar-actions">
          {primary && <button type={primary.form ? 'submit' : 'button'} form={primary.form} disabled={primary.disabled} className="ph-bar-btn" onClick={primary.onClick}>{primary.label}</button>}
          <MoreMenu items={rest} />
        </div>
      </div>
      {(!compact || aside || children) && (
        <header className={`ph ph-narrow${compact ? ' ph-compact' : ''}`}>
          {!compact && (
            <div className="ph-head">
              <h1 className="ph-title" ref={titleRef}>{title}</h1>
              {aside}
            </div>
          )}
          {compact && aside}
          {children && <div className="ph-meta">{children}</div>}
        </header>
      )}
    </>
  )
}

function MoreMenu({ items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (items.length === 0) return null
  return (
    <div className="ph-more" ref={ref}>
      <button
        type="button"
        className="ph-more-btn"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {open && (
        <div className="ph-menu" role="menu">
          {items.map(a => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              className={a.danger ? 'danger' : undefined}
              onClick={() => { setOpen(false); a.onClick() }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
