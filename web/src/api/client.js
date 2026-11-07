import axios from 'axios'
import { reportReachable, isUnreachable, requestStarted, requestEnded } from '../utils/connection.js'

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
  return config
})

client.interceptors.response.use(
  res => { requestEnded(res.config.splittyRequest); reportReachable(true); return res },
  err => {
    requestEnded(err.config?.splittyRequest)
    // Any answer, even an error, means the server is reachable.
    if (err.response) reportReachable(true)
    else if (err.code !== 'ERR_CANCELED') reportReachable(false)
    if (err.response?.status === 401 && !err.config?.url?.includes('/auth/')) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export default client