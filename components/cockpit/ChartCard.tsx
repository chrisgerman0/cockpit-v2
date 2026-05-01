'use client'

import { cn } from '@/lib/utils'

type ChartCardProps = {
  title: string
  periodLabel?: string
  range: string
  onRangeChange?: (range: string) => void
  ranges?: string[]
  children: React.ReactNode
  className?: string
}

/**
 * Framed chart container with title, timeframe selector, and period caption.
 */
export function ChartCard({ title, periodLabel, range, onRangeChange, ranges = ['1M', '3M', '6M', '1Y', 'ALL'], children, className }: ChartCardProps) {
  return (
    <section className={cn('cockpit-card rounded-md p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-label font-semibold uppercase text-muted-foreground">{title}</h2>
        <div className="flex rounded-sm border border-border/80 bg-background/45 p-0.5">
          {ranges.map(item => (
            <button
              key={item}
              className={cn('min-h-8 rounded-xs px-3 text-xs text-muted-foreground transition-colors hover:text-foreground', item === range && 'bg-accent text-accent-foreground shadow-glow')}
              onClick={() => onRangeChange?.(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      {children}
      {periodLabel ? <div className="num mt-2 text-center text-[11px] text-muted-foreground">{periodLabel}</div> : null}
    </section>
  )
}
