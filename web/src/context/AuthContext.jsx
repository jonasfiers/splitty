import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'
import client from '../api/client'
import { clearOffline } from '../utils/offlineDocs.js'
import { reactivatePushIfKnown } from '../utils/push.js'

const AuthContext = createContext(null)

const decodeJwt = t => {
  try { return JSON.parse(atob(t.split('.')[1])) } catch { return null }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token'))

  const currentUser = token ? decodeJwt(token) : null

  // Whether the user is an admin, asked from the API (the role is not in the
  // JWT). Only decides what the app shows: the server checks the role itself on
  // every admin request. null while not known yet. A token refresh (profile
  // edit) keeps the last answer while it asks again, so nothing flickers.
  const [admin, setAdmin] = useState({ known: false, isAdmin: false })
  useEffect(() => {
    if (!token) return
    let live = true
    let timer = null
    // A network blip or 5xx is retried (up to 3 tries, a few seconds apart)
    // rather than taken as "not an admin"; a 401/403 is a real answer.
    const ask = attempt => client.get('/admin/me')
      .then(r => { if (live) setAdmin({ known: true, isAdmin: r.data?.isAdmin === true }) })
      .catch(err => {
        if (!live) return
        const status = err?.response?.status
        if (status === 401 || status === 403 || attempt >= 3) setAdmin({ known: true, isAdmin: false })
        else timer = setTimeout(() => ask(attempt + 1), 3000 * attempt)
      })
    ask(1)
    return () => { live = false; clearTimeout(timer) }
  }, [token])
  const isAdmin = !token ? false : admin.known ? admin.isAdmin : null
  const forgetAdmin = () => setAdmin({ known: false, isAdmin: false })

  const login = useCallback(async (email, password) => {
    const { data } = await client.post('/auth/login', { email, password })
    forgetAdmin()
    localStorage.setItem('token', data.token)
    setToken(data.token)
    reactivatePushIfKnown().catch(() => {})
  }, [])

  const register = useCallback(async (name, email, password) => {
    await client.post('/auth/register', { name, email, password })
  }, [])

  // `autofill`: the browser offers the passkey in the email field's own
  // suggestions (conditional mediation) and this waits until one is picked;
  // starting another passkey sign-in (the button) cancels it.
  const passkeyLogin = useCallback(async ({ autofill = false } = {}) => {
    const { data: { options, nonce } } = await client.post('/auth/passkey/login/options', autofill ? { autofill: true } : {})
    const assertionResponse = await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill })
    const { data } = await client.post('/auth/passkey/login/verify', { nonce, assertionResponse })
    forgetAdmin()
    localStorage.setItem('token', data.token)
    setToken(data.token)
    reactivatePushIfKnown().catch(() => {})
  }, [])

  const updateToken = useCallback((newToken) => {
    localStorage.setItem('token', newToken)
    setToken(newToken)
  }, [])

  // Signing out (or deleting the account) also removes the documents kept on
  // this device; an expired session does not (utils/offlineDocs.js).
  const logout = useCallback(() => {
    clearOffline()
    localStorage.removeItem('token')
    forgetAdmin()
    setToken(null)
  }, [])

  return (
    <AuthContext.Provider value={{ token, currentUser, isAdmin, login, register, logout, passkeyLogin, updateToken }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
