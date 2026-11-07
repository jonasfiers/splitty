import axios from 'axios'
import { reportReachable } from '../utils/connection.js'

// A time limit: without a connection a request does not always fail at once
// (on a phone with a VPN in airplane mode it just never gets an answer), and
// a page would show "Loading…" forever. Slow ones set their own: uploads and
// the export 2 minutes, the route finder 45 s.
const client = axios.create({ baseURL: '/api', timeout: 12000 })

client.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

client.interceptors.response.use(
  res => { reportReachable(true); return res },
  err => {
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