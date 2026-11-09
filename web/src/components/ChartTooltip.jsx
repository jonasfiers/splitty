export default function ChartTooltip({ title, value }) {
  return (
    <div className="ins-tip chart-tip">
      <div className="chart-tip-title">{title}</div>
      <div className="ins-tip-amt-sm">{value}</div>
    </div>
  )
}
