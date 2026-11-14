import { asIcon } from '../Icon/Icon.jsx'
import { tintClass } from '../../utils/categoryColours.js'

// tint: a category colour's key for the icon square (utils/categoryColours.js)
function IconCard({ icon, tint, title, subtitle, iconStyle, actions }) {
    return (
        <div className="card icon-card">
            <div className="icon-card-row">
                <span className={`icon-card-icon ${tintClass(tint)}`.trim()} style={iconStyle}>{asIcon(icon)}</span>
                <div className="icon-card-text">
                    <div className="icon-card-title">{title}</div>
                    {subtitle && <div className="icon-card-sub">{subtitle}</div>}
                </div>
                {actions && <div className="icon-card-actions">{actions}</div>}
            </div>
        </div>
    )
}

export default IconCard