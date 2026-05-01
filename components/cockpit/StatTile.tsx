import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type StatTileVariant = 'default' | 'positive' | 'negative' | 'accent'

type StatTileProps = {
  label: string
  value: string
  caption?: string
  icon: LucideIcon
  variant?: StatTileVariant
  className?: string
}

/**
 * Compact metric tile for cockpit status, PNL, and headline strategy stats.
 */
export function StatTile({ label, value, caption, icon: Icon, variant = 'default', className }: StatTileProps) {
  const tone = {
    default: 'text-foreground',
    positive: 'text-positive',
    negative: 'text-negative',
    accent: 'text-accent',
  }[variant]

  return (
    <article className={cn('cockpit-card rounded-md p-4', className)}>
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/12 text-accent">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="text-label font-semibold uppercase text-muted-foreground">{label}</div>
          <div className={cn('num mt-1 text-2xl font-semibold leading-none', tone)}>{value}</div>
          {caption ? <div className="mt-1 text-xs text-muted-foreground">{caption}</div> : null}
        </div>
      </div>
    </article>
  )
}
