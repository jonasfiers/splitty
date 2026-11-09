function IconCard({ icon, title, subtitle, iconStyle, actions }) {
    return (
        <div className="card icon-card">
            <div className="icon-card-row">
                <span className="icon-card-icon" style={iconStyle}>{icon}</span>
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