import { cn } from '@/lib/utils'

type LeverageGaugeProps = {
  value: number
  max?: number
  className?: string
}

/**
 * Semi-circular leverage dial with green-yellow-red risk gradient.
 */
export function LeverageGauge({ value, max = 10, className }: LeverageGaugeProps) {
  const clamped = Math.min(max, Math.max(0, value))
  const angle = -180 + (clamped / max) * 180
  return (
    <div className={cn('cockpit-card rounded-md p-4', className)}>
      <div className="text-label font-semibold uppercase text-muted-foreground">Current Leverage</div>
      <div className="mt-0.5 flex items-end justify-between gap-3">
        <svg viewBox="0 0 180 104" className="h-[70px] w-32 overflow-visible" role="img" aria-label={`Current leverage ${value}x`}>
          <path d="M20 88 A70 70 0 0 1 160 88" fill="none" stroke="hsl(var(--muted))" strokeWidth="12" strokeLinecap="round" />
          <path d="M20 88 A70 70 0 0 1 160 88" fill="none" stroke="url(#levGradient)" strokeWidth="12" strokeLinecap="round" pathLength="100" strokeDasharray={`${(clamped / max) * 100} 100`} />
          <defs>
            <linearGradient id="levGradient" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#55d66b" />
              <stop offset="58%" stopColor="#D4A017" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
          </defs>
          {[0, 2, 3, 5, 10].map(tick => {
            const tickAngle = (-180 + (tick / max) * 180) * (Math.PI / 180)
            const x = 90 + Math.cos(tickAngle) * 78
            const y = 88 + Math.sin(tickAngle) * 78
            return <text key={tick} x={x} y={y} className="fill-muted-foreground text-[10px]">{tick}x</text>
          })}
          <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '90px 88px' }}>
            <line x1="90" y1="88" x2="22" y2="88" stroke="hsl(var(--foreground))" strokeWidth="2" strokeLinecap="round" />
          </g>
          <circle cx="90" cy="88" r="4" fill="hsl(var(--foreground))" />
        </svg>
        <div className="num pb-3 text-3xl font-semibold text-accent">{value.toFixed(1)}x</div>
      </div>
    </div>
  )
}
