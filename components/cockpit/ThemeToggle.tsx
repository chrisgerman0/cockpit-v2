'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'

/**
 * Persisted sun/moon segmented toggle for the top bar.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme !== 'light'
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1 border-accent/25 bg-background/55 px-2"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label="Toggle theme"
    >
      <Sun className="h-4 w-4 text-muted-foreground" />
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-foreground">
        {dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </span>
    </Button>
  )
}
