'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeft, Circle } from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { navItems } from './mock-data'

type SidebarProps = {
  mobileOpen?: boolean
  onClose?: () => void
}

/**
 * Primary cockpit navigation. Desktop is a persistent rail; mobile renders
 * the same content inside a drawer controlled by TopBar.
 */
export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-border/70 bg-background/88 backdrop-blur-xl lg:flex">
        <SidebarInner />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={(open) => !open && onClose?.()}>
        <SheetContent side="left" className="w-72 border-border/80 bg-background p-0">
          <SidebarInner onNavigate={onClose} />
        </SheetContent>
      </Sheet>
    </>
  )
}

function SidebarInner({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-16 items-center px-5">
        <img src="/brand/staxs-logo-dark.svg" alt="staxs" width={116} height={27} className="hidden dark:block" />
        <img src="/brand/staxs-logo-light.svg" alt="staxs" width={116} height={27} className="block dark:hidden" />
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map(item => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                active && 'bg-accent/18 text-accent shadow-[inset_3px_0_0_hsl(var(--accent))]',
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
      <div className="space-y-4 p-4">
        <div className="rounded-md border border-accent/20 bg-accent/8 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Circle className="h-3 w-3 fill-positive text-positive" />
            Systems Online
          </div>
          <div className="mt-1 text-xs text-muted-foreground">All systems operational</div>
        </div>
        <button className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground hover:text-foreground" type="button">
          <ChevronLeft className="h-4 w-4" />
          Collapse
        </button>
      </div>
    </div>
  )
}
