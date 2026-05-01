'use client'

import Image from 'next/image'
import { Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { fmtPct, fmtUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ChartCard } from './ChartCard'
import { EquityChart } from './EquityChart'
import { LeverageGauge } from './LeverageGauge'
import { PositionCard } from './PositionRow'
import { StatTile } from './StatTile'
import { StreakDots } from './StreakDots'
import { TickerBar } from './TickerBar'
import { TradeCard } from './TradeRow'
import { equityData, positions, statCards, tickerAssets, trades, type Position, type Trade } from './mock-data'

type DashboardMockupProps = {
  includeTicker?: boolean
  className?: string
}

/**
 * Production dashboard composition matching the selected Obsidian Ledger mockup.
 */
export function DashboardMockup({ includeTicker = true, className }: DashboardMockupProps) {
  return (
    <div className={cn('mx-auto max-w-[1440px] px-3 pb-16 pt-3 sm:px-5 lg:px-5', className)}>
      <div className="grid gap-2.5 xl:grid-cols-[0.78fr_1.42fr]">
        <AccountBalanceCard />
        <ChartCard
          title="Equity Curve"
          range="6M"
          periodLabel="6M Performance (Nov 18, 2023 - May 18, 2024)"
          className="min-h-[210px] p-4"
        >
          <EquityChart data={equityData} range="6M" />
        </ChartCard>
      </div>

      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map(card => <StatTile key={card.label} {...card} className="min-h-[86px]" />)}
      </div>

      <div className="mt-2.5 grid gap-2.5 xl:grid-cols-[1.05fr_1.45fr]">
        <DataPanel title="Open Positions" footer="1 open position">
          <div className="grid gap-2 md:hidden">
            {positions.map(position => <PositionCard key={position.pair} position={position} />)}
          </div>
          <div className="hidden md:block">
            <CompactPositions positions={positions} />
          </div>
        </DataPanel>
        <DataPanel title="Recent Trades" footer="5 recent trades">
          <div className="grid gap-2 md:hidden">
            {trades.map(trade => <TradeCard key={`${trade.pair}-${trade.time}`} trade={trade} />)}
          </div>
          <div className="hidden md:block">
            <CompactTrades trades={trades} />
          </div>
        </DataPanel>
      </div>

      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-[1.1fr_1fr_1fr_1.35fr]">
        <LeverageGauge value={7.5} className="min-h-[100px]" />
        <SmallStat title="Win Rate (Last 20)" value="65%" caption="13 wins, 7 losses" />
        <SmallStat title="Win Rate (Last 50)" value="68%" caption="34 wins, 16 losses" />
        <article className="cockpit-card min-h-[100px] rounded-md p-4">
          <div className="text-label font-semibold uppercase text-muted-foreground">Current Streak</div>
          <div className="num mt-1 text-2xl font-semibold text-accent">+1W</div>
          <div className="text-xs text-muted-foreground">1 consecutive win</div>
          <StreakDots className="mt-3" results={['W', 'W', 'W', 'W', 'W', 'W', 'L', 'W', 'W', 'W', 'L', 'L', 'W', 'W']} />
        </article>
      </div>

      {includeTicker ? <TickerBar assets={tickerAssets} /> : null}
    </div>
  )
}

function CompactPositions({ positions }: { positions: Position[] }) {
  return (
    <div className="num text-xs">
      <div className="grid grid-cols-[1.1fr_.8fr_.9fr_1.25fr_1.25fr_1.1fr_.9fr] border-b border-border/70 px-3 pb-2 text-[9px] uppercase tracking-wider text-muted-foreground">
        <span>Pair</span><span>Side</span><span>Size</span><span>Entry Price</span><span>Mark Price</span><span>PNL (USD)</span><span>PNL (%)</span>
      </div>
      {positions.map(position => (
        <div key={position.pair} className="grid h-10 grid-cols-[1.1fr_.8fr_.9fr_1.25fr_1.25fr_1.1fr_.9fr] items-center border-b border-border/60 px-3">
          <strong className="font-semibold">{position.pair}</strong>
          <Badge variant="positive" className="w-fit text-[9px]">{position.side}</Badge>
          <span>{position.size}</span>
          <span>{fmtUsd(position.entryPrice)}</span>
          <span>{fmtUsd(position.markPrice)}</span>
          <span className="text-positive">{fmtUsd(position.pnlUsd)}</span>
          <span className="text-positive">{fmtPct(position.pnlPct, { sign: true })}</span>
        </div>
      ))}
    </div>
  )
}

function CompactTrades({ trades }: { trades: Trade[] }) {
  return (
    <div className="num text-xs">
      <div className="grid grid-cols-[1.15fr_.75fr_.9fr_1.2fr_1.2fr_1fr_.85fr_1.1fr] border-b border-border/70 px-3 pb-2 text-[9px] uppercase tracking-wider text-muted-foreground">
        <span>Pair</span><span>Side</span><span>Size</span><span>Entry Price</span><span>Exit Price</span><span>PNL (USD)</span><span>PNL (%)</span><span>Time</span>
      </div>
      {trades.map(trade => (
        <div key={`${trade.pair}-${trade.time}`} className="grid h-7 grid-cols-[1.15fr_.75fr_.9fr_1.2fr_1.2fr_1fr_.85fr_1.1fr] items-center border-b border-border/45 px-3">
          <strong className="font-semibold">{trade.pair}</strong>
          <Badge variant={trade.side === 'LONG' ? 'positive' : 'negative'} className="w-fit text-[9px]">{trade.side}</Badge>
          <span>{trade.size}</span>
          <span>{fmtUsd(trade.entryPrice)}</span>
          <span>{fmtUsd(trade.exitPrice)}</span>
          <span className="text-positive">{fmtUsd(trade.pnlUsd)}</span>
          <span className="text-positive">{fmtPct(trade.pnlPct, { sign: true })}</span>
          <span className="text-muted-foreground">{trade.time}</span>
        </div>
      ))}
    </div>
  )
}

function AccountBalanceCard() {
  return (
    <section className="cockpit-card relative min-h-[210px] overflow-hidden rounded-md p-4">
      <div className="relative z-10">
        <h2 className="text-label font-semibold uppercase text-muted-foreground">Account Balance</h2>
        <div className="num mt-5 text-5xl font-medium tracking-tight text-foreground sm:text-[52px]">$10,247.83</div>
        <div className="mt-3 inline-flex items-center gap-2 rounded-sm border border-accent/35 bg-accent/10 px-3 py-1.5 text-sm font-semibold text-accent">
          <Star className="h-4 w-4" />
          <span>Bold tier · 1.0× of balance</span>
        </div>
        <div className="mt-5 max-w-lg">
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
            <span>BTC Goal</span>
            <span className="num text-accent">0.0621 BTC</span>
          </div>
          <div className="relative">
            <Progress value={6.21} className="h-2.5" />
            <span className="absolute left-[6.21%] top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white shadow-glow">₿</span>
          </div>
          <div className="num mt-2 flex justify-between text-xs text-muted-foreground">
            <span>0 BTC</span>
            <span>1 BTC</span>
          </div>
        </div>
      </div>
      <Image src="/brand/staxs-icon-gold-transparent-2048px.png" alt="" width={155} height={155} className="absolute bottom-3 right-5 opacity-[0.11]" />
      <div className="absolute inset-x-0 bottom-0 h-28 bg-[radial-gradient(circle_at_72%_100%,rgba(212,160,23,.28),transparent_20rem)]" />
    </section>
  )
}

function DataPanel({ title, footer, children }: { title: string; footer: string; children: React.ReactNode }) {
  return (
    <section className="cockpit-card rounded-md p-4 md:h-[220px] md:overflow-hidden">
      <h2 className="mb-2.5 text-label font-semibold uppercase text-muted-foreground">{title}</h2>
      {children}
      <div className="num mt-2 border-t border-border/70 pt-2 text-center text-xs text-muted-foreground">{footer}</div>
    </section>
  )
}

function SmallStat({ title, value, caption }: { title: string; value: string; caption: string }) {
  return (
    <article className="cockpit-card min-h-[100px] rounded-md p-4">
      <div className="text-label font-semibold uppercase text-muted-foreground">{title}</div>
      <div className="num mt-2 text-2xl font-semibold text-accent">{value}</div>
      <div className="text-xs text-muted-foreground">{caption}</div>
    </article>
  )
}
