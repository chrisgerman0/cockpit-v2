'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

/**
 * Persists light/dark mode on the html element through next-themes.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="staxs-theme">
      {children}
    </NextThemesProvider>
  )
}
