import { Link } from 'react-router'
import { useAuth } from '../../context/AuthContext'
import { Avatar } from '../Avatar.jsx'
import CatAvatar from '../CatAvatar/CatAvatar'
import { useMediaQuery } from '../../utils/useMediaQuery.js'
import './PageHeader.css'

// The header of a top-level page (Home, Trips, Activity, Insights...).
//
// Phone: a large title (or, on Home, the Splitty logo) with the page's own
// action and the user's avatar (-> Profile) on the right. There is no global
// app bar on phones any more; this and PageHeader take its place.
// Desktop: the title and the action only; the sidebar has the logo and avatar.
//
// logo:   show the Splitty logo instead of a title (Home); nothing on desktop
// aside:  the page's action(s), e.g. a "+ New" button
// avatar: show the avatar on phones (off on Profile itself)
export default function TabHeader({ title, logo = false, aside = null, avatar = true }) {
  const wide = useMediaQuery('(min-width: 768px)')
  const { currentUser } = useAuth()

  if (wide) {
    if (logo && !aside) return null
    return (
      <header className="th th-wide">
        {logo ? <span /> : <h1 className="th-title">{title}</h1>}
        {aside && <div className="th-aside">{aside}</div>}
      </header>
    )
  }

  return (
    <header className="th th-narrow">
      {logo ? (
        <span className="app-logo th-logo">
          <CatAvatar className="app-logo-icon" />
          <span>Split<span className="app-logo-accent">ty</span></span>
        </span>
      ) : (
        <h1 className="th-title">{title}</h1>
      )}
      <div className="th-aside">
        {aside}
        {avatar && (
          <Link to="/profile" className="app-avatar" aria-label="Profile">
            <Avatar name={currentUser?.name} size={28} colorIndex={currentUser?.avatarColor} emoji={currentUser?.avatarEmoji} />
          </Link>
        )}
      </div>
    </header>
  )
}
