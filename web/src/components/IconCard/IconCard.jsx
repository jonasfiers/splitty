function IconCard({ icon, title, subtitle, iconStyle, actions }) {
    return (
        <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0, ...iconStyle }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
                    {subtitle && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{subtitle}</div>}
                </div>
                {actions && <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>{actions}</div>}
            </div>
        </div>
    )
}

export default IconCard