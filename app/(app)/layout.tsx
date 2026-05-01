'use client'

import { useState } from 'react'
import { Sidebar } from '@/components/cockpit/Sidebar'
import { TopBar } from '@/components/cockpit/TopBar'
import { ThemeProvider } from '@/components/theme-provider'

/**
 * App shell — sidebar + sticky top bar + content. Auth gate temporarily off.
 * Mobile sidebar is toggled by the hamburger in TopBar.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <ThemeProvider>
      <div className="min-h-screen bg-background text-foreground transition-colors">
        <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
        <div className="min-w-0 lg:pl-48">
          <TopBar onMenuClick={() => setMobileOpen(o => !o)} />
          <main>
            {children}
          </main>
        </div>
      </div>
    </ThemeProvider>
  )
}
