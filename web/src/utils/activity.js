import { itemIcon } from './trip.js'

// Shared by the Activity page and Home's "Recent activity" panel. A row is an
// expense event (kind 'expense') or a trip event ('trip', 'tripItem', 'file').

export const isTripActivity = a => a.kind && a.kind !== 'expense'

export const activityLink = a => {
  if (a.kind === 'trip') return `/trips/${a.tripId}`
  if (a.kind === 'tripItem' || a.kind === 'file') return `/trips/${a.tripId}/items/${a.itemId}`
  return a.groupId ? `/groups/${a.groupId}/expenses/${a.expenseId}` : '/activity'
}

// "added", "updated", "settled up", "added to Taiwan", "uploaded a file to Flight"...
export const activityVerb = (a, { settled = 'settled up' } = {}) => {
  const edited = a.action === 'UPDATED_BY'
  switch (a.kind) {
    case 'trip': return edited ? 'updated the trip' : 'created the trip'
    case 'tripItem': return `${edited ? 'updated' : 'added'} in ${a.tripTitle}`
    case 'file': return `uploaded a file to ${a.itemTitle}`
    default: return a.isSettlement ? settled : edited ? 'updated' : 'added'
  }
}

// For the Activity page's type chips.
export const activityMatches = (a, type) => {
  if (type === 'all') return true
  if (type === 'trips') return isTripActivity(a)
  if (type === 'settlements') return a.isSettlement
  if (type === 'edited') return a.action === 'UPDATED_BY'
  if (type === 'added') return !a.isSettlement && a.action !== 'UPDATED_BY'
  return false
}

// The icon box: + / ✎ / ✓ for expenses, the item's own icon for trip events.
export const activityIcon = a => {
  if (a.kind === 'trip') return '🧳'
  if (a.kind === 'file') return '📎'
  if (a.kind === 'tripItem') return itemIcon({ kind: a.itemKind, mode: a.itemMode })
  return a.isSettlement ? '✓' : a.action === 'CREATED_BY' ? '＋' : '✎'
}
export const activityTone = a => (a.isSettlement ? 'settlements' : a.action === 'UPDATED_BY' ? 'edited' : 'added')
