import { formatCurrency, formatDate } from './currency.js'

// Turns the API's change records ({ field, from, to, ... }, amounts in minor
// units) into short phrases: "amount €40.00 → €45.00", "paid by Jonas → Hendrik".
export function describeChange(c) {
  const money = (v, iso) => formatCurrency(v, iso)
  switch (c.field) {
    case 'description': return `name “${c.from}” → “${c.to}”`
    case 'currency': return `currency ${c.from} → ${c.to}`
    case 'amount': return `amount ${money(c.from, c.fromCurrency)} → ${money(c.to, c.toCurrency)}`
    case 'date': return `date ${formatDate(c.from)} → ${formatDate(c.to)}`
    case 'category': return `category ${c.from ?? 'none'} → ${c.to ?? 'none'}`
    case 'group': return `moved from ${c.from} to ${c.to}`
    case 'paidBy': return `paid by ${c.from ?? 'nobody'} → ${c.to}`
    case 'share':
      if (!c.from) return `${c.name} now shares ${money(c.to, c.toCurrency)}`
      if (!c.to) return `${c.name} no longer shares`
      return `${c.name}’s share ${money(c.from, c.fromCurrency)} → ${money(c.to, c.toCurrency)}`
    default: return c.field
  }
}

// One line for a list row: the first few changes, then "+N more".
export function summarizeChanges(changes, max = 2) {
  if (!changes?.length) return ''
  const shown = changes.slice(0, max).map(describeChange).join(' · ')
  return changes.length > max ? `${shown} · +${changes.length - max} more` : shown
}
