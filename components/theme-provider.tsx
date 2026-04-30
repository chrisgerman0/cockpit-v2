'use client'

import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'dark' | 'light'
type Ctx = { theme: Theme; toggle: () => void; set: (t: Theme) => void }

const ThemeContext = createContext<Ctx | null>(null)
const STORAGE_KEY = 'staxs-theme'

/**
 * Theme provider — light / dark, persisted to localStorage. Mirrors the
 * existing staxs-landing pattern so users keep their theme across both
 * apps. Default = dark (matches the cockpit aesthetic).
 *
 * To avoid the FOUC flash on first paint, we set the html.className from
 * a tiny inline script in the document head BEFORE React hydrates. That
 * script lives in app/layout.tsx via a <script dangerouslySetInnerHTML>.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Read once on mount; SSR renders nothing theme-specific so server/client
  // don't disagree.
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    let initial: Theme = 'dark'
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
      if (stored === 'dark' || stored === 'light') initial = stored
    } catch {}
    setTheme(initial)
    applyTheme(initial)
  }, [])

  function applyTheme(t: Theme) {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (t === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
  }

  function set(t: Theme) {
    setTheme(t)
    try { localStorage.setItem(STORAGE_KEY, t) } catch {}
    applyTheme(t)
  }

  function toggle() { set(theme === 'dark' ? 'light' : 'dark') }

  return (
    <ThemeContext.Provider value={{ theme, toggle, set }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
