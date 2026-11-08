import { Link, useNavigate } from 'react-router'
import { previousPath } from '../utils/history.js'

// A link "back" to `to`: goes back through the history when that is the page
// behind this one (so the history does not grow page, parent, page, parent…),
// otherwise a normal link. `replace`: forms, which should not stay in the
// history once left.
export default function BackLink({ to, replace = false, className, children, ...rest }) {
  const navigate = useNavigate()
  const onClick = event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (previousPath() === to.split('?')[0]) {
      event.preventDefault()
      navigate(-1)
    }
  }
  return <Link to={to} replace={replace} className={className} onClick={onClick} {...rest}>{children}</Link>
}
