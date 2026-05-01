import { Maximize2, Signal } from 'lucide-react'
import { fmtPct, fmtUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { TickerAsset } from './mock-data'

/**
 * Bottom-fixed market ticker for five tracked assets and feed latency.
 */
export function TickerBar({ assets }: { assets: TickerAsset[] }) {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-accent/25 bg-background/92 pl-0 backdrop-blur-xl lg:pl-48">
      <div className="mx-auto flex max-w-[1440px] items-center overflow-x-auto">
        {assets.map(asset => (
          <div key={asset.symbol} className="flex min-h-11 min-w-36 items-center gap-2 border-r border-border/70 px-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">{asset.symbol[0]}</span>
            <div>
              <div className="num text-xs font-semibold">{asset.symbol} <span className="text-muted-foreground">{fmtUsd(asset.price)}</span></div>
              <div className={cn('num text-xs', asset.change >= 0 ? 'text-positive' : 'text-negative')}>{fmtPct(asset.change, { sign: true })}</div>
            </div>
            <svg width="42" height="20" viewBox="0 0 54 22" className={asset.change >= 0 ? 'text-positive' : 'text-negative'} aria-hidden>
              <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points="0,15 8,13 14,16 22,11 30,12 38,7 46,9 54,4" />
            </svg>
          </div>
        ))}
        <div className="ml-auto flex min-h-11 min-w-36 items-center gap-4 px-3">
          <span className="flex items-center gap-2 text-xs text-positive"><span className="h-2 w-2 rounded-full bg-positive" />Live</span>
          <span className="num flex items-center gap-2 text-xs text-positive"><Signal className="h-4 w-4" />28ms</span>
          <button className="min-h-11 rounded-md px-2 text-muted-foreground hover:text-foreground" aria-label="Fullscreen">
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </footer>
  )
}
