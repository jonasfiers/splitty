import { createContext, useContext, useState, useCallback } from 'react'
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

  const login = useCallback(async (email, password) => {
    const { data } = await client.post('/auth/login', { email, password })
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
    setToken(null)
  }, [])

  return (
    <AuthContext.Provider value={{ token, currentUser, login, register, logout, passkeyLogin, updateToken }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
