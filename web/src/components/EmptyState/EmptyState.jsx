// "Nothing here": one look for every empty list, page or search.
//
// <EmptyState title="No trips yet" action={<button …>New trip</button>}>
//   Plan the transport, the stays and the things to do.
// </EmptyState>
//
// title:    what is (not) there, short
// children: the line under it: why, or what to do
// action:   a button or link to do something about it
// art:      false for no picture: a search that found nothing, a page
//           that doesn't exist (the cat with its empty bowl is for "nothing yet")
// compact:  inside a page section (a tab, a list): less room, a smaller cat
export default function EmptyState({ title, children, action, art = true, compact = false, className = '' }) {
  return (
    <div className={`empty-state${compact ? ' empty-state-compact' : ''} ${className}`.trim()}>
      {art && <img className="empty-state-art" src="/cat-empty.svg" alt="" />}
      {title && <p className="empty-state-title">{title}</p>}
      {children && <p className="empty-state-sub">{children}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}
