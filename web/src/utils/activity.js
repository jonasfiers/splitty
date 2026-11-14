import { itemIcon } from './trip.js'
import { iconOr } from './icons.js'

// Shared by the Activity page and Home's "Recent activity" panel. A row is an
// expense event (kind 'expense') or a trip event ('trip', 'tripItem', 'file').

export const isTripActivity = a => a.kind && a.kind !== 'expense'

// Deleted things have nothing left to open.
export const isDeletedActivity = a => a.action === 'DELETED_BY'

export const activityLink = a => {
  if (isDeletedActivity(a)) return null
  if (a.kind === 'trip') return `/trips/${a.tripId}`
  if (a.kind === 'tripItem' || a.kind === 'file') return `/trips/${a.tripId}/items/${a.itemId}`
  return a.groupId ? `/groups/${a.groupId}/expenses/${a.expenseId}` : '/activity'
}

export const actionOf = a =>
  a.action === 'DELETED_BY' ? 'deleted' : a.action === 'UPDATED_BY' ? 'edited' : 'added'

// "added", "updated", "deleted", "settled up", "added in Taiwan", "uploaded a file to Flight"...
export const activityVerb = (a, { settled = 'settled up' } = {}) => {
  const action = actionOf(a)
  switch (a.kind) {
    case 'trip': return { added: 'created the trip', edited: 'updated the trip', deleted: 'deleted the trip' }[action]
    case 'tripItem': return `${{ added: 'added', edited: 'updated', deleted: 'deleted' }[action]} in ${a.tripTitle}`
    case 'file': return action === 'deleted' ? `removed a file from ${a.itemTitle}` : `uploaded a file to ${a.itemTitle}`
    default:
      if (a.isSettlement) return action === 'deleted' ? 'cancelled a settlement' : settled
      return { added: 'added', edited: 'updated', deleted: 'deleted' }[action]
  }
}

// The Activity page's two filters: context (all | expenses | trips) and
// action (all | added | edited | deleted). Settlements count as expenses.
export const activityMatches = (a, context, action) =>
  (context === 'all' || (context === 'trips') === isTripActivity(a)) &&
  (action === 'all' || actionOf(a) === action)

// The icon (utils/icons.js) in the box shows what the row is about (the expense's category, the
// trip item's kind...) in the same way for every kind of row; a small badge
// in its corner shows what happened to it (see activityBadge).
export const activityIcon = a => {
  if (a.kind === 'trip') return 'luggage'
  if (a.kind === 'file') return 'paperclip'
  if (a.kind === 'tripItem') return itemIcon({ kind: a.itemKind, mode: a.itemMode })
  if (a.isSettlement) return 'handshake'
  if (a.isTransfer) return 'arrow-left-right'
  return iconOr(a.categoryIcon, 'receipt')
}
export const activityTone = a => actionOf(a)
