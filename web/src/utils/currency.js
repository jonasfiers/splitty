// Currencies whose official minor unit (ISO 4217, 2 decimals) is not used in
// everyday money: CLDR's cash digits are 0 for them (supplemental currencyData,
// checked 2026-11-13). Amounts are still stored and entered in the official
// unit; only whole amounts lose their ".00" on screen (NT$1,000, but NT$1,000.50).
// Currencies whose official decimals are already 0 (JPY, KRW, HUF, IDR...) need nothing.
const WHOLE_IN_PRACTICE = new Set(['AMD', 'CRC', 'CZK', 'GYD', 'MNT', 'MUR', 'NOK', 'PKR', 'RSD', 'SEK', 'TWD', 'TZS', 'UZS'])

const formatCurrency = (amount, iso = 'EUR') => {
    const formatter = new Intl.NumberFormat(navigator.language, {
        style: "currency",
        currency: iso,
        ...(WHOLE_IN_PRACTICE.has(iso) ? { trailingZeroDisplay: 'stripIfInteger' } : {}),
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