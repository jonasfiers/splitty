import client from '../api/client'

// Pages show what they showed last time at once, and fetch it fresh at the
// same moment ("stale while revalidate"). In memory only: while the app runs
// (a reload, or the phone freeing the app, starts empty); cleared on signing
// out and in, so no one sees someone else's data, and emptied by any change
// you make (below). Only reads are kept.
//
//   const { cached, fresh } = swr([['/dash/groups'], ['/trips', { params }]], ([groups, trips]) => …)
//
// `apply` gets axios-like responses ({ data }), in the order asked: at once
// when every one is cached, and again when the fresh ones are in, but only if
// something changed (so a page that is already right doesn't redraw).
// `cached`: whether it was applied at once (the page can skip "Loading").
// `fresh`: the server's answer, a promise; it rejects as client.get does.
// { fresh: true }: skip the cache (a reload after a change, "Try again").

const store = new Map() // key -> { data, at }
// Bumped by every emptying: an answer to a request sent before it (before
// your change) is not kept, so it can't bring the old state back.
let generation = 0
const MAX_ENTRIES = 200

const keyOf = (url, config) => {
  const params = config?.params ? new URLSearchParams(Object.entries(config.params).filter(([, v]) => v != null && v !== '')).toString() : ''
  return params ? `${url}?${params}` : url
}

// Answers with links to files in them: those links are signed for 5 minutes
// (FILE_LINK_TTL in the API), so a kept copy is only used while they still work.
const MAX_AGE_MS = [
  [/^\/trips\/[^/?]+\/documents$/, 4 * 60 * 1000],
  [/^\/trips\/items\/[^/?]+$/, 4 * 60 * 1000],
]
const usable = key => {
  const hit = store.get(key)
  if (!hit) return undefined
  const limit = MAX_AGE_MS.find(([re]) => re.test(key))?.[1]
  return limit && Date.now() - hit.at > limit ? undefined : hit.data
}

export function swr(requests, apply, { fresh: skipCache = false } = {}) {
  const keys = requests.map(([url, config]) => keyOf(url, config))
  const hits = keys.map(usable)
  const cached = !skipCache && hits.every(h => h !== undefined)
  if (cached) apply(hits.map(data => ({ data })))

  const sentIn = generation
  const fresh = Promise.all(requests.map(([url, config]) => client.get(url, config))).then(responses => {
    if (sentIn === generation) responses.forEach((res, i) => remember(keys[i], res.data))
    const changed = !cached || responses.some((res, i) => JSON.stringify(res.data) !== JSON.stringify(hits[i]))
    if (changed) apply(responses)
    return responses
  })
  return { cached, fresh }
}

// One request, for parts that load on their own (a card, a panel).
export const swrOne = (url, apply, options) => {
  const { cached, fresh } = swr([[url]], ([res]) => apply(res), options)
  return { cached, fresh: fresh.then(([res]) => res) }
}

// For forms: the kept copy if there is one, once (a form must not be redrawn
// under someone typing), and the server's answer kept for next time; without
// a copy, the server's answer. Only for lists around a form (categories,
// members...): what is being edited always comes fresh.
export function getOnce(url, config) {
  const key = keyOf(url, config)
  const hit = usable(key)
  const sentIn = generation
  const fresh = client.get(url, config).then(res => { if (sentIn === generation) remember(key, res.data); return res })
  if (hit !== undefined) { fresh.catch(() => {}); return Promise.resolve({ data: hit }) }
  return fresh
}

function remember(key, data) {
  store.delete(key) // re-inserted last: the oldest go first when full
  store.set(key, { data, at: Date.now() })
  if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value)
}

export function clearCache() {
  store.clear()
  generation++
}

// Any change that went through (a save, a delete, a settlement, a bar dragged
// on the timeline) empties it: coming back to a page must never show the
// state from before your own change. The next visit of each page loads fresh,
// once.
client.interceptors.response.use(res => {
  if ((res.config?.method || 'get').toLowerCase() !== 'get') clearCache()
  return res
})
