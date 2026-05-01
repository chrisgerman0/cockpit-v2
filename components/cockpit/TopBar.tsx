'use client'

import { Bell, Menu } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { BtcChip } from './BtcChip'
import { ThemeToggle } from './ThemeToggle'

type TopBarProps = {
  onMenuClick?: () => void
}

/**
 * Sticky top bar with mobile menu trigger, brand mark, BTC chip, language
 * toggle, notifications, theme control, and avatar.
 */
export function TopBar({ onMenuClick }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/86 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 lg:px-5">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick} aria-label="Open sidebar">
          <Menu className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2 lg:hidden">
          <img src="/brand/staxs-logo-dark.svg" alt="staxs" width={64} height={15} className="hidden dark:block" />
          <img src="/brand/staxs-logo-light.svg" alt="staxs" width={64} height={15} className="block dark:hidden" />
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <BtcChip />
          <Button variant="outline" size="icon" aria-label="Notifications" className="hidden bg-background/55 min-[360px]:inline-flex">
            <Bell className="h-4 w-4" />
          </Button>
          <div className="hidden min-h-11 items-center rounded-md border border-border bg-background/55 p-1 text-xs md:flex">
            <button className="min-h-8 rounded-sm bg-accent px-2 font-semibold text-accent-foreground" type="button">ENG</button>
            <button className="min-h-8 rounded-sm px-2 text-muted-foreground" type="button">PT</button>
          </div>
          <ThemeToggle />
          <Avatar className="h-11 w-11 border border-border bg-muted">
            <AvatarFallback className="num text-sm">JD</AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  )
}
