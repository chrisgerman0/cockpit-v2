'use client'

import Image from 'next/image'
import { Star } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fmtUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ChartCard } from './ChartCard'
import { EquityChart } from './EquityChart'
import { LeverageGauge } from './LeverageGauge'
import { PositionCard, PositionRow } from './PositionRow'
import { StatTile } from './StatTile'
import { StreakDots } from './StreakDots'
import { TickerBar } from './TickerBar'
import { TradeCard, TradeRow } from './TradeRow'
import { equityData, positions, statCards, tickerAssets, trades } from './mock-data'

type DashboardMockupProps = {
  includeTicker?: boolean
  className?: string
}

/**
 * Production dashboard composition matching the selected Obsidian Ledger mockup.
 */
export function DashboardMockup({ includeTicker = true, className }: DashboardMockupProps) {
  return (
    <div className={cn('mx-auto max-w-[1440px] px-4 pb-20 pt-4 sm:px-5', className)}>
      <div className="grid gap-3 xl:grid-cols-[1fr_1.7fr]">
        <AccountBalanceCard />
        <ChartCard
          title="Equity Curve"
          range="6M"
          periodLabel="6M Performance (Nov 18, 2023 - May 18, 2024)"
          className="min-h-64"
        >
          <EquityChart data={equityData} range="6M" />
        </ChartCard>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map(card => <StatTile key={card.label} {...card} />)}
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.05fr_1.45fr]">
        <DataPanel title="Open Positions" footer="1 open position">
          <div className="grid gap-2 md:hidden">
            {positions.map(position => <PositionCard key={position.pair} position={position} />)}
          </div>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pair</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Entry Price</TableHead>
                  <TableHead>Mark Price</TableHead>
                  <TableHead>PNL (USD)</TableHead>
                  <TableHead>PNL (%)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map(position => <PositionRow key={position.pair} position={position} />)}
              </TableBody>
            </Table>
          </div>
        </DataPanel>
        <DataPanel title="Recent Trades" footer="5 recent trades">
          <div className="grid gap-2 md:hidden">
            {trades.map(trade => <TradeCard key={`${trade.pair}-${trade.time}`} trade={trade} />)}
          </div>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
              <TableRow>
                <TableHead>Pair</TableHead>
                <TableHead>Side</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Entry Price</TableHead>
                <TableHead>Exit Price</TableHead>
                <TableHead>PNL (USD)</TableHead>
                <TableHead>PNL (%)</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map(trade => <TradeRow key={`${trade.pair}-${trade.time}`} trade={trade} />)}
              </TableBody>
            </Table>
          </div>
        </DataPanel>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.35fr]">
        <LeverageGauge value={7.5} />
        <SmallStat title="Win Rate (Last 20)" value="65%" caption="13 wins, 7 losses" />
        <SmallStat title="Win Rate (Last 50)" value="68%" caption="34 wins, 16 losses" />
        <article className="cockpit-card rounded-md p-4">
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

function AccountBalanceCard() {
  return (
    <section className="cockpit-card relative min-h-64 overflow-hidden rounded-md p-5">
      <div className="relative z-10">
        <h2 className="text-label font-semibold uppercase text-muted-foreground">Account Balance</h2>
        <div className="num mt-8 text-5xl font-medium tracking-tight text-foreground sm:text-6xl">$10,247.83</div>
        <div className="mt-5 inline-flex items-center gap-2 rounded-sm border border-accent/35 bg-accent/10 px-3 py-2 text-sm font-semibold text-accent">
          <Star className="h-4 w-4" />
          <span>Bold tier · 1.0× of balance</span>
        </div>
        <div className="mt-6 max-w-lg">
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
      <Image src="/brand/staxs-logo-dark.svg" alt="" width={220} height={50} className="absolute bottom-8 right-6 hidden opacity-[0.10] dark:block" />
      <Image src="/brand/staxs-logo-light.svg" alt="" width={220} height={50} className="absolute bottom-8 right-6 block opacity-[0.08] dark:hidden" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-[radial-gradient(circle_at_70%_100%,rgba(212,160,23,.28),transparent_24rem)]" />
    </section>
  )
}

function DataPanel({ title, footer, children }: { title: string; footer: string; children: React.ReactNode }) {
  return (
    <section className="cockpit-card rounded-md p-4">
      <h2 className="mb-3 text-label font-semibold uppercase text-muted-foreground">{title}</h2>
      {children}
      <div className="num mt-3 border-t border-border/70 pt-2 text-center text-xs text-muted-foreground">{footer}</div>
    </section>
  )
}

function SmallStat({ title, value, caption }: { title: string; value: string; caption: string }) {
  return (
    <article className="cockpit-card rounded-md p-4">
      <div className="text-label font-semibold uppercase text-muted-foreground">{title}</div>
      <div className="num mt-2 text-2xl font-semibold text-accent">{value}</div>
      <div className="text-xs text-muted-foreground">{caption}</div>
    </article>
  )
}
