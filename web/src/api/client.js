import axios from 'axios'
import { reportReachable, suspectUnreachable, isUnreachable, requestStarted, requestEnded } from '../utils/connection.js'

// A time limit: without a connection a request does not always fail at once
// (on a phone with a VPN in airplane mode it just never gets an answer), and
// a page would show "Loading…" forever. Slow ones set their own: uploads and
// the export 2 minutes, the route finder 45 s.
const DEFAULT_TIMEOUT_MS = 12000
const client = axios.create({ baseURL: '/api', timeout: DEFAULT_TIMEOUT_MS })

// Without a connection, fail fast: at once when the browser knows it is
// offline, and with a 4 s limit (not 12) while the server is known to be
// unreachable, so moving between pages offline does not wait 12 s each time.
// Requests with their own longer limit (uploads, the route finder) keep it.
const UNREACHABLE_TIMEOUT = 4000

client.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  if (navigator.onLine === false) {
    throw new axios.AxiosError('No connection', axios.AxiosError.ERR_NETWORK, config)
  }
  if (isUnreachable() && (config.timeout ?? DEFAULT_TIMEOUT_MS) <= DEFAULT_TIMEOUT_MS) config.timeout = UNREACHABLE_TIMEOUT
  config.splittyRequest = requestStarted()
  config.splittyStarted = performance.now()
  return config
})

// Requests that ended without any answer, reported to the server once it
// answers again (api/routes/clientLog.js): which ones break off, and how.
const brokenOff = []
function noteBrokenOff(err, retry) {
  const config = err.config || {}
  brokenOff.push({
    method: (config.method || 'get').toUpperCase(),
    path: String(config.url || '').split('?')[0],
    code: err.code || err.message,
    ms: performance.now() - (config.splittyStarted ?? performance.now()),
    online: navigator.onLine,
    retry,
    page: location.pathname,
  })
  if (brokenOff.length > 20) brokenOff.shift()
  console.warn('[splitty] request ended without an answer:', brokenOff.at(-1))
}
function sendBrokenOff() {
  if (!brokenOff.length) return
  const body = JSON.stringify({ events: brokenOff.splice(0) })
  fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
}

const RETRY_AFTER_MS = 400

client.interceptors.response.use(
  res => {
    requestEnded(res.config.splittyRequest)
    reportReachable(true)
    sendBrokenOff()
    return res
  },
  async err => {
    requestEnded(err.config?.splittyRequest)
    // Any answer, even an error, means the server is reachable.
    if (err.response) reportReachable(true)
    else if (err.code !== 'ERR_CANCELED') {
      const config = err.config
      // A read that broke off without an answer (not one that timed out:
      // that would only wait twice as long) is tried once more: a one-off
      // hiccup should not empty a card or flash the offline bar.
      const retryable = config && (config.method || 'get') === 'get' && !config.splittyRetried
        && err.code !== 'ECONNABORTED' && navigator.onLine !== false
      noteBrokenOff(err, retryable ? 'retrying' : 'none')
      if (retryable) {
        config.splittyRetried = true
        await new Promise(r => setTimeout(r, RETRY_AFTER_MS))
        return client(config)
      }
      // The offline bar only once the server is confirmed out of reach.
      suspectUnreachable()
    }
    if (err.response?.status === 401 && !err.config?.url?.includes('/auth/')) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export default client