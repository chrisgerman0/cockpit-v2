'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  TrendingUp,
  BarChart3,
  Users2,
  ShieldAlert,
  Settings as SettingsIcon,
  X,
} from 'lucide-react'

/**
 * Sidebar — light + dark themed. Navigation is via Next.js <Link> so it's
 * client-side, instant SPA feel. On mobile (< lg) the sidebar slides over
 * the content; on desktop it's a fixed left rail.
 */

type NavItem = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'default' | 'admin'
}

const NAV: NavItem[] = [
  { href: '/',            label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/live',        label: 'Live Trading', icon: TrendingUp },
  { href: '/backtesting', label: 'Backtesting',  icon: BarChart3 },
  { href: '/broker',      label: 'Broker',       icon: Users2 },
  { href: '/admin',       label: 'Admin',        icon: ShieldAlert, tone: 'admin' },
  { href: '/settings',    label: 'Settings',     icon: SettingsIcon },
]

export function Sidebar({ mobileOpen, onClose }: { mobileOpen?: boolean; onClose?: () => void }) {
  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-zinc-950/40 backdrop-blur-sm z-40"
          onClick={onClose}
        />
      )}
      <aside
        className={`
          fixed lg:sticky top-0 left-0 z-50 lg:z-0
          w-60 shrink-0 h-screen
          border-r border-zinc-200 dark:border-zinc-800/80
          bg-white dark:bg-zinc-950
          flex flex-col
          transition-transform lg:transition-none
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Brand */}
        <div className="px-5 h-14 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-zinc-950 font-bold text-sm">
              S
            </div>
            <div className="text-base font-semibold tracking-tight">staxs</div>
          </div>
          {/* Close button on mobile */}
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto">
          <NavGroup label="Trading">
            {NAV.slice(0, 4).map(item => <NavLink key={item.href} item={item} onClick={onClose} />)}
          </NavGroup>
          <NavGroup label="System" className="mt-4">
            {NAV.slice(4).map(item => <NavLink key={item.href} item={item} onClick={onClose} />)}
          </NavGroup>
        </nav>

        <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800/60 text-[10px] text-zinc-500 dark:text-zinc-600 font-mono">
          cockpit v2 · port 3007
        </div>
      </aside>
    </>
  )
}

function NavGroup({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <div className="px-3 mb-1.5 text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-600 font-semibold">
        {label}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

function NavLink({ item, onClick }: { item: NavItem; onClick?: () => void }) {
  const pathname = usePathname()
  const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
  const isAdmin = item.tone === 'admin'
  const Icon = item.icon
  const cls = [
    'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
    isActive
      ? isAdmin
        ? 'bg-rose-50 text-rose-600 font-medium dark:bg-rose-500/10 dark:text-rose-400'
        : 'bg-amber-50 text-amber-700 font-medium dark:bg-amber-500/10 dark:text-amber-400'
      : isAdmin
        ? 'text-rose-500/90 hover:bg-rose-50 dark:text-rose-400/70 dark:hover:bg-zinc-900 dark:hover:text-rose-400'
        : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100',
  ].join(' ')
  return (
    <Link href={item.href} className={cls} onClick={onClick}>
      <Icon className="w-4 h-4 shrink-0" />
      <span>{item.label}</span>
    </Link>
  )
}
