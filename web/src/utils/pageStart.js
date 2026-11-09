// When the current page was opened (a route change), for Loading's delay.
let openedAt = performance.now()
export const markPageOpened = () => { openedAt = performance.now() }
export const sincePageOpened = () => performance.now() - openedAt
