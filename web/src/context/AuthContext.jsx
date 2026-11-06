import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'
import client from '../api/client'
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
    client.get('/admin/me')
      .then(r => { if (live) setAdmin({ known: true, isAdmin: r.data?.isAdmin === true }) })
      .catch(() => { if (live) setAdmin({ known: true, isAdmin: false }) })
    return () => { live = false }
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

  const passkeyLogin = useCallback(async (email) => {
    const { data: { options, nonce } } = await client.post('/auth/passkey/login/options', { email })
    const assertionResponse = await startAuthentication({ optionsJSON: options })
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

  const logout = useCallback(() => {
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
