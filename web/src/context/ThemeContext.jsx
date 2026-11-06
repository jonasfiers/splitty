import { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext(null)

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(
    () => localStorage.getItem('theme') || 'system'
  )

  const setTheme = value => {
    setThemeState(value)
    localStorage.setItem('theme', value)
  }

  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && systemDark())
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
      // The phone's status bar (Android/Chrome) takes this colour: match the
      // page background so the top of the app is one colour in either theme.
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      let meta = document.querySelector('meta[name="theme-color"]')
      if (!meta) {
        meta = document.createElement('meta')
        meta.name = 'theme-color'
        document.head.appendChild(meta)
      }
      if (bg) meta.content = bg
    }

    apply()

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)