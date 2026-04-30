'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, Menu, Moon, Sun, ChevronDown, LogOut, Settings as SettingsIcon, User } from 'lucide-react'
import { useTheme } from './theme-provider'
import { BtcTicker } from './btc-ticker'

/**
 * Top bar — sticky header above all pages. Mirrors the existing staxs-landing
 * top bar feature set so the cockpit feels continuous with v1:
 *   • BTC live price chip (Bitget public ticker, 10s poll)
 *   • Notifications bell (placeholder badge for now)
 *   • Theme toggle (dark/light, persisted via ThemeProvider)
 *   • User menu (avatar dropdown → settings, sign out)
 *   • Mobile menu hamburger (toggles sidebar — wired by Sidebar component)
 *
 * Style note: every interactive element has hover states + transition for
 * the "polished" feel. No bare buttons.
 */
export function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { theme, toggle } = useTheme()
  const [userOpen, setUserOpen] = useState(false)
  const userRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!userRef.current?.contains(e.target as Node)) setUserOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800/80 bg-white/85 dark:bg-zinc-950/85 backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 px-4 lg:px-6 h-14">
        {/* Left: hamburger (mobile) */}
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
          aria-label="Toggle menu"
        >
          <Menu className="w-4 h-4" />
        </button>
        <div className="flex-1" />

        {/* Right: BTC ticker · bell · theme · avatar */}
        <div className="flex items-center gap-2">
          <BtcTicker />

          <button
            className="relative p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors text-zinc-600 dark:text-zinc-400"
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            {/* Placeholder badge — wire to real unread count later */}
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-500" />
          </button>

          <button
            onClick={toggle}
            className="p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors text-zinc-600 dark:text-zinc-400"
            aria-label={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* User menu */}
          <div ref={userRef} className="relative">
            <button
              onClick={() => setUserOpen(o => !o)}
              className="flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-zinc-950 font-bold text-xs">
                S
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
            </button>

            {userOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg overflow-hidden">
                <div className="px-3 py-3 border-b border-zinc-200 dark:border-zinc-800">
                  <div className="text-sm font-medium">Signed in</div>
                  <div className="text-xs text-zinc-500 truncate">cockpit v2 preview</div>
                </div>
                <div className="py-1">
                  <MenuItem icon={User}        label="Profile"  href="/settings" onClick={() => setUserOpen(false)} />
                  <MenuItem icon={SettingsIcon} label="Settings" href="/settings" onClick={() => setUserOpen(false)} />
                </div>
                <div className="border-t border-zinc-200 dark:border-zinc-800 py-1">
                  <MenuItem icon={LogOut} label="Sign out" tone="rose" onClick={() => {
                    // Real sign-out wires later; for now this is a placeholder.
                    alert('Sign-out wires to Supabase once auth is enabled.')
                    setUserOpen(false)
                  }} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

function MenuItem({
  icon: Icon, label, href, onClick, tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  href?: string
  onClick?: () => void
  tone?: 'rose'
}) {
  const cls = `flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors w-full text-left ${
    tone === 'rose' ? 'text-rose-500 dark:text-rose-400' : ''
  }`
  if (href) {
    return (
      <a href={href} className={cls} onClick={onClick}>
        <Icon className="w-4 h-4" />{label}
      </a>
    )
  }
  return (
    <button className={cls} onClick={onClick}>
      <Icon className="w-4 h-4" />{label}
    </button>
  )
}
