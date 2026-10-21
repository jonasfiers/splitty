const formatCurrency = (amount, iso = 'EUR') => {
    const formatter = new Intl.NumberFormat(navigator.language, {
        style: "currency",
        currency: iso,
    });
    const value = amount / 10** formatter.resolvedOptions().maximumFractionDigits;
    return formatter.format(value);
}

// Short form for chart axes and key figures: €8.2K instead of €8,200.00.
const formatCompactCurrency = (amount, iso = 'EUR') => {
    const decimals = new Intl.NumberFormat(navigator.language, { style: "currency", currency: iso })
        .resolvedOptions().maximumFractionDigits;
    return new Intl.NumberFormat(navigator.language, {
        style: "currency",
        currency: iso,
        notation: "compact",
        maximumFractionDigits: 1,
    }).format(amount / 10 ** decimals);
}

const formatDate = (raw) => {
  if (!raw) return ''
  const d = new Date(raw)
  if (isNaN(d)) return raw
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}-${mm}-${d.getUTCFullYear()}`
}

export { formatCurrency, formatCompactCurrency, formatDate }