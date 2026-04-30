'use client'

import { useState } from 'react'
import { Sidebar } from '@/components/sidebar'
import { TopBar } from '@/components/topbar'
import { ThemeProvider } from '@/components/theme-provider'

/**
 * App shell — sidebar + sticky top bar + content. Auth gate temporarily off.
 * Mobile sidebar is toggled by the hamburger in TopBar.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <ThemeProvider>
      <div className="flex min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 transition-colors">
        <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
        <div className="flex-1 min-w-0 flex flex-col">
          <TopBar onMenuClick={() => setMobileOpen(o => !o)} />
          <main className="flex-1 overflow-x-auto">
            {children}
          </main>
        </div>
      </div>
    </ThemeProvider>
  )
}
