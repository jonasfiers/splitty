export default function ChartTooltip({ title, value }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, boxShadow: 'var(--shadow-md)' }}>
      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      <div style={{ color: 'var(--accent-text)', fontFamily: 'var(--font-mono)' }}>{value}</div>
    </div>
  )
}
