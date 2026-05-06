'use client'

import { useEffect, useState } from 'react'
import { Icons } from '@/components/cockpit/stax/Icons'
import type { StaxDashboardData, Position, Trade, CoinSym, TickerAsset, StatCardSpec } from '@/components/cockpit/stax/StaxDashboard'

// Coin symbol type alias used by the user-trade Position/Trade builders below.
type _CoinSymInternal = CoinSym
import { authedFetch, browserClient } from './api'
import { usePublicTickers, type PublicTicker } from './use-public-tickers'
import { fetchPortfolioTrades, type PortfolioTrade, type Tier } from './use-portfolio-trades'

const V1_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'SUIUSDT'] as const

const TIER_LABEL: Record<string, string> = {
  conservative: 'Conservative tier · 0.5× of balance',
  bold:         'Bold tier · 1.0× of balance',
  aggressive:   'Aggressive tier · 1.5× of balance',
}

const TIER_LEV_CAP: Record<string, number> = {
  conservative: 4, bold: 10, aggressive: 20,
}

// Account-wide leverage gauge upper bound = theoretical peak leverage when
// all 5 legs are open AND each is pyramided (1.5× notional). Picked per
// tier so the gauge needle has room to grow but doesn't look empty.
//   Conservative 0.5× × 5 × 1.5 = 3.75 → cap 4
//   Bold         1.0× × 5 × 1.5 = 7.5  → cap 8
//   Aggressive   1.5× × 5 × 1.5 = 11.25 → cap 12
const TIER_GAUGE_MAX: Record<string, number> = {
  conservative: 4, bold: 8, aggressive: 12,
}

type RawTrade = {
  id: string
  symbol: string
  side: 'long' | 'short'
  entry_price: number | string | null
  exit_price: number | string | null
  size_usd: number | string | null
  pnl_usd: number | string | null
  pnl_pct: number | string | null
  status: string
  opened_at: string | null
  closed_at: string | null
}

type BalanceResp = { equity?: number; available?: number; unrealizedPnl?: number; error?: string }
type BotConfigResp = {
  activated?: boolean
  config?: { tier?: string; preset?: string; leverage?: number; activation_balance?: number; hb_base_notional_usd?: number; compound?: boolean } | null
}

function symToCoin(sym: string): CoinSym {
  const s = sym.replace('USDT', '') as CoinSym
  return (['BTC', 'ETH', 'SOL', 'XRP', 'SUI'] as const).includes(s) ? s : 'BTC'
}

function fmtUsdSign(v: number): string {
  const abs = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v >= 0 ? `+$${abs}` : `−$${abs}`
}
function fmtPctSign(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}
function fmtPx(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '$—'
  if (v < 1) return `$${v.toFixed(4)}`
  if (v < 100) return `$${v.toFixed(2)}`
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtSize(units: number): string {
  if (!Number.isFinite(units) || units === 0) return '0'
  if (units >= 1000) return units.toLocaleString(undefined, { maximumFractionDigits: 1 })
  if (units >= 100) return units.toFixed(0)
  if (units >= 1) return units.toFixed(2)
  return units.toFixed(4)
}
function fmtTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}
// Long-form timestamp shown stacked under entry/exit prices in the Open
// Positions / Recent Trades tables. Format: "6 May 2026, 13:14".
function fmtTradeTs(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return ''
  const d = new Date(ms)
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${date}, ${time}`
}

function buildEquityCurve(trades: RawTrade[], startCapital: number) {
  const chrono = trades.filter(t => t.status === 'closed' && t.closed_at).slice().reverse()
  const points: Array<{ ts: number; value: number; month: string }> = []
  let eq = startCapital
  let prevLabel = ''
  if (chrono.length === 0) {
    points.push({ ts: Date.now() - 7 * 86400_000, value: startCapital, month: '' })
    points.push({ ts: Date.now(), value: startCapital, month: '' })
    return { points, monthLabels: [] as string[] }
  }
  // Include start anchor so curve doesn't start from first trade's pnl baseline.
  points.push({ ts: new Date(chrono[0].closed_at!).getTime() - 86400_000, value: startCapital, month: '' })
  for (const t of chrono) {
    eq += Number(t.pnl_usd || 0)
    const d = new Date(t.closed_at!)
    const label = d.toLocaleString('en-US', { month: 'short' }) + " '" + String(d.getFullYear()).slice(2)
    const showLabel = label !== prevLabel
    if (showLabel) prevLabel = label
    points.push({ ts: d.getTime(), value: Math.round(eq * 100) / 100, month: showLabel ? label : '' })
  }
  // Distinct month labels across chart for the x-axis ticks
  const monthLabels = Array.from(new Set(points.map(p => p.month).filter(Boolean)))
  return { points, monthLabels }
}

function buildWinRate(trades: RawTrade[], n: number) {
  const closed = trades.filter(t => t.status === 'closed' && t.pnl_usd != null).slice(0, n)
  let wins = 0, losses = 0
  for (const t of closed) (Number(t.pnl_usd) > 0 ? wins++ : losses++)
  const total = wins + losses
  return { pct: total ? Math.round((wins / total) * 100) : 0, wins, losses }
}

function buildStreak(trades: RawTrade[]): StaxDashboardData['streak'] {
  const closed = trades.filter(t => t.status === 'closed' && t.pnl_usd != null)
  let len = 0
  let kind: 'W' | 'L' | null = null
  for (const t of closed) {
    const cur = Number(t.pnl_usd) > 0 ? 'W' : 'L'
    if (kind === null) { kind = cur; len = 1; continue }
    if (cur === kind) len++
    else break
  }
  const recent = closed.slice(0, 14).reverse().map(t => Number(t.pnl_usd) > 0 ? 'W' : 'L') as Array<'W' | 'L'>
  if (!kind || len === 0) return { value: '–', sub: 'No trades yet', recent: [], isWin: true }
  const sign = kind === 'W' ? '+' : '−'
  const word = kind === 'W' ? (len === 1 ? 'win' : 'wins') : (len === 1 ? 'loss' : 'losses')
  return { value: `${sign}${len}${kind}`, sub: `${len} consecutive ${word}`, recent, isWin: kind === 'W' }
}

// ─── Strategy (portfolio backtest) helpers ──────────────────────────────────
//
// FUTURE-CUTOVER NOTE — 2026-05-02
// These dashboard widgets currently read from the strategy's backtest trade
// ledger (`/data/strategies/satoshi-stacker/portfolio-trades.json`). That's
// 9656 trades from 6.8yr of simulation — useful as social proof while the
// user has fewer than ~5 of their own real trades.
//
// Once a user has accumulated enough personal trade history (ballpark: 5+
// closed real-money trades), swap Recent Trades + Win Rate Last 20/50 +
// Streak + Equity Curve back to user-derived data:
//   - Re-fetch /api/trades?limit=50
//   - Use the existing buildEquityCurve / buildWinRate / buildStreak helpers
//   - Realized PnL stays on portfolio (or switch to user — TBD)
// Keep the portfolio path as a fallback for new users.

function buildEquityCurveFromPortfolio(trades: PortfolioTrade[], startCapital: number) {
  const points: Array<{ ts: number; value: number; month: string }> = []
  if (trades.length === 0) {
    points.push({ ts: Date.now() - 7 * 86400_000, value: startCapital, month: '' })
    points.push({ ts: Date.now(), value: startCapital, month: '' })
    return { points, monthLabels: [] as string[] }
  }
  // 9656 points is too many for a smooth chart — sample down to ~180.
  const SAMPLE_TARGET = 180
  const step = Math.max(1, Math.floor(trades.length / SAMPLE_TARGET))
  let eq = startCapital
  let prevLabel = ''
  // Anchor at start
  const firstTs = trades[0].entryTs
  points.push({ ts: firstTs - 86400_000, value: startCapital, month: '' })
  for (let i = 0; i < trades.length; i++) {
    eq += trades[i].pnl || 0
    if (i % step !== 0 && i !== trades.length - 1) continue
    const d = new Date(trades[i].exitTs)
    const label = d.toLocaleString('en-US', { month: 'short' }) + " '" + String(d.getFullYear()).slice(2)
    const showLabel = label !== prevLabel
    if (showLabel) prevLabel = label
    points.push({ ts: trades[i].exitTs, value: Math.round(eq * 100) / 100, month: showLabel ? label : '' })
  }
  const monthLabels = Array.from(new Set(points.map(p => p.month).filter(Boolean)))
  return { points, monthLabels }
}

function isOpenPortfolioTrade(t: PortfolioTrade): boolean {
  return t.reason === 'eod' || /^open/i.test(t.displayReason || '')
}

function winRateFromPortfolio(trades: PortfolioTrade[], n: number) {
  // Open trades are unrealised — exclude from win-rate. Otherwise a winning
  // open position counts as a "win" before the user has actually banked it.
  const closed = trades.filter(t => !isOpenPortfolioTrade(t))
  const recent = closed.slice(-n)
  let wins = 0, losses = 0
  for (const t of recent) (t.pnl > 0 ? wins++ : losses++)
  const total = wins + losses
  return { pct: total ? Math.round((wins / total) * 100) : 0, wins, losses }
}

function streakFromPortfolio(trades: PortfolioTrade[]): StaxDashboardData['streak'] {
  if (trades.length === 0) return { value: '–', sub: 'No trades yet', recent: [], isWin: true }
  // Same exclusion rule as win-rate: streak counts only closed trades. The
  // open trade still appears in the dots row (tagged 'O*') so the user sees
  // its current state, but doesn't get folded into the consecutive count.
  const closed = trades.filter(t => !isOpenPortfolioTrade(t))
  const open = trades.find(isOpenPortfolioTrade) ?? null
  let len = 0
  let kind: 'W' | 'L' | null = null
  for (let i = closed.length - 1; i >= 0; i--) {
    const cur: 'W' | 'L' = closed[i].pnl > 0 ? 'W' : 'L'
    if (kind === null) { kind = cur; len = 1; continue }
    if (cur === kind) len++
    else break
  }
  // Recent dots — last 10 NEWEST trades (closed), oldest→newest left-to-right.
  // If there's a live open trade, append it as 'OW'/'OL' on the right so the
  // user sees the current state of the position; the renderer pulses it.
  const baseDots = closed.slice(open ? -9 : -10).map(t => (t.pnl > 0 ? 'W' : 'L') as 'W' | 'L')
  const dots: Array<'W' | 'L' | 'OW' | 'OL'> = [...baseDots]
  if (open) dots.push(open.pnl > 0 ? 'OW' : 'OL')
  if (!kind || len === 0) return { value: '–', sub: 'No trades yet', recent: dots, isWin: true }
  const sign = kind === 'W' ? '+' : '−'
  const word = kind === 'W' ? (len === 1 ? 'win' : 'wins') : (len === 1 ? 'loss' : 'losses')
  return { value: `${sign}${len}${kind}`, sub: `${len} consecutive ${word}`, recent: dots, isWin: kind === 'W' }
}

function buildStats(opts: {
  unrealizedPnl: number
  realizedPnl: number
  totalReturnPct: number
  openCount: number
  closedCount: number
  activated: boolean
  openSide?: 'long' | 'short'
  openSymbol?: string
}): StatCardSpec[] {
  const { unrealizedPnl, realizedPnl, totalReturnPct, openCount, closedCount, activated, openSide, openSymbol } = opts
  return [
    {
      label: 'Bot Status',
      icon: Icons.Robot,
      value: openCount > 0
        ? <span className={openSide === 'short' ? 'neg-text' : 'pos-text'}><span className="dot-live" />{openSide === 'short' ? 'SHORT' : 'LONG'}</span>
        : (activated ? <span className="pos-text"><span className="dot-live" />Active</span> : <span style={{ color: 'var(--muted)' }}>Off</span>),
      sub: openCount > 0 ? (openSymbol || 'in market') : (activated ? 'Watching' : 'Activate to start'),
    },
    {
      label: 'Unrealized PnL',
      icon: Icons.TrendUp,
      value: openCount === 0 ? '$0' : fmtUsdSign(unrealizedPnl),
      sub: openCount === 0 ? 'No open position' : `${openCount} ${openCount === 1 ? 'leg' : 'legs'} open`,
      valueClass: openCount === 0 ? '' : (unrealizedPnl >= 0 ? 'pos' : 'neg'),
    },
    {
      label: 'Realized PnL',
      icon: Icons.Check,
      value: closedCount === 0 ? '$0' : fmtUsdSign(realizedPnl),
      sub: closedCount === 0 ? 'No trades yet' : `${closedCount} closed`,
      valueClass: closedCount === 0 ? '' : (realizedPnl >= 0 ? 'pos' : 'neg'),
    },
    {
      label: 'Total Return',
      icon: Icons.TrendUp,
      value: fmtPctSign(totalReturnPct),
      sub: 'All time',
      valueClass: totalReturnPct >= 0 ? 'pos' : 'neg',
    },
  ]
}

export type StaxLoadState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'no-keys' }
  | { status: 'no-bot' }
  | { status: 'ready'; data: StaxDashboardData }
  | { status: 'error'; message: string }

export function useStaxDashboardData(): StaxLoadState {
  const [state, setState] = useState<StaxLoadState>({ status: 'loading' })
  const tickers = usePublicTickers(30000)

  useEffect(() => {
    let cancelled = false
    let intervalId: number | null = null

    async function load() {
      try {
        const sb = browserClient()
        const { data: { session } } = await sb.auth.getSession()
        if (!session) { if (!cancelled) setState({ status: 'unauthenticated' }); return }

        const [botRes, balanceRes, userTradesRes] = await Promise.all([
          authedFetch<BotConfigResp>('/api/bot-activate').catch(() => null),
          authedFetch<BalanceResp>('/api/balance').catch((e: Error) => ({ error: e.message } as BalanceResp)),
          // Bitget-sourced (see use-live-trading-data.tsx for rationale).
          authedFetch<{ trades: RawTrade[] }>('/api/trades-live?limit=50').catch(() => ({ trades: [] as RawTrade[] })),
        ])
        if (cancelled) return

        if (balanceRes && 'error' in balanceRes && /no api keys/i.test(balanceRes.error || '')) {
          setState({ status: 'no-keys' }); return
        }
        const cfg = botRes?.config
        if (!botRes?.activated || !cfg) { setState({ status: 'no-bot' }); return }

        const tier = ((cfg.tier || cfg.preset || 'conservative').toLowerCase()) as Tier
        const tierLabel = TIER_LABEL[tier] ?? TIER_LABEL.conservative

        const balance = balanceRes && !('error' in balanceRes && balanceRes.error) ? balanceRes : null
        const equity = Number(balance?.equity || 0)
        const unrealizedPnl = Number(balance?.unrealizedPnl || 0)

        // User account state — used for Open Positions + Bot Status only (real money).
        const userTrades = userTradesRes?.trades || []
        const openTrades = userTrades.filter(t => t.status === 'open')

        // Strategy backtest trades — source of truth for Recent Trades + the
        // derived stats (win rate, streak, equity curve, realized pnl, total
        // return). These mirror what the Backtesting page shows so the dashboard
        // surfaces the strategy's track record, not the user's personal slice.
        const portfolio = await fetchPortfolioTrades(tier).catch(() => [] as PortfolioTrade[])
        if (cancelled) return

        // Realised pnl + return % — strategy view. Matches the Backtesting page.
        const realizedPnl = portfolio.reduce((s, t) => s + (t.pnl || 0), 0)
        const startCapital = 10000  // strategy account base used by the daemon
        const totalReturnPct = startCapital > 0 ? (realizedPnl / startCapital) * 100 : 0

        const tickerBySymbol: Record<string, PublicTicker | undefined> = {}
        tickers.forEach(t => { tickerBySymbol[t.symbol] = t })
        const btcPrice = tickerBySymbol['BTCUSDT']?.price || 0
        const btcGoal = btcPrice > 0 ? Math.min(1, equity / btcPrice) : 0

        let positions: Position[] = openTrades.map(t => {
          const entry = Number(t.entry_price || 0)
          const mark = tickerBySymbol[t.symbol]?.price || entry
          const sizeUsd = Number(t.size_usd || 0)
          const sizeUnits = entry > 0 ? sizeUsd / entry : 0
          const dir = t.side === 'long' ? 1 : -1
          const pnlUsd = (mark - entry) * sizeUnits * dir
          const pnlPct = entry > 0 ? ((mark - entry) / entry) * 100 * dir : 0
          const entryTsMs = t.opened_at ? new Date(t.opened_at).getTime() : null
          return {
            sym: symToCoin(t.symbol), pair: t.symbol,
            side: t.side === 'long' ? 'LONG' : 'SHORT',
            size: fmtSize(sizeUnits),
            entry: fmtPx(entry),
            mark: fmtPx(mark),
            pnl: fmtUsdSign(pnlUsd),
            pnlPct: fmtPctSign(pnlPct),
            pos: pnlUsd >= 0,
            entryTs: fmtTradeTs(entryTsMs),
          }
        })

        // Fallback: when the user has no real open positions on the exchange,
        // surface what the STRATEGY is currently long/short on. These are
        // sourced from portfolio-trades.json — entries with `reason: 'eod'`
        // are the strategy's still-open positions at end-of-data (the
        // simulator force-closed them only because it ran out of bars; in
        // live trading they'd still be open).
        //
        // P&L is calculated using the user's BALANCE-scaled notional so the
        // numbers match what would actually happen if the bot opened it for
        // them right now. Marked with fromStrategy:true so the UI can render
        // a distinct badge.
        if (positions.length === 0) {
          const strategyOpen = portfolio.filter(isOpenPortfolioTrade)
          // Latest open per symbol (in case the file has multiple eod entries
          // for the same asset across cycles — keep the freshest).
          const bySymbol = new Map<string, typeof strategyOpen[0]>()
          for (const t of strategyOpen) {
            const cur = bySymbol.get(t.symbol)
            if (!cur || t.entryTs > cur.entryTs) bySymbol.set(t.symbol, t)
          }
          const balance = equity || startCapital
          const scale = balance / startCapital
          positions = Array.from(bySymbol.values()).map(t => {
            const entry = t.entryPx
            const mark = tickerBySymbol[t.symbol]?.price || entry
            // Strategy's notional was sized for $10k base — scale to user's balance
            const sizeUsd = (t.notional || 0) * scale
            const sizeUnits = entry > 0 ? sizeUsd / entry : 0
            const dir = t.dir
            const pnlUsd = (mark - entry) * sizeUnits * dir
            const pnlPct = entry > 0 ? ((mark - entry) / entry) * 100 * dir : 0
            return {
              sym: symToCoin(t.symbol), pair: t.symbol,
              side: dir === 1 ? 'LONG' : 'SHORT',
              size: fmtSize(sizeUnits),
              entry: fmtPx(entry),
              mark: fmtPx(mark),
              pnl: fmtUsdSign(pnlUsd),
              pnlPct: fmtPctSign(pnlPct),
              pos: pnlUsd >= 0,
              fromStrategy: true,
              entryTs: fmtTradeTs(t.entryTs),
            }
          })
        }

        // Recent Trades widget — last 5 CLOSED strategy backtest trades
        // (newest first). Open trades (reason: 'eod') are filtered out so
        // they don't duplicate the Open Positions card on the left.
        const closedOnly = portfolio.filter(t => !isOpenPortfolioTrade(t))
        const lastFive = closedOnly.slice(-5).reverse()
        const trades: Trade[] = lastFive.map(t => {
          const sizeUnits = t.entryPx > 0 ? t.notional / t.entryPx : 0
          return {
            sym: symToCoin(t.symbol),
            pair: t.symbol,
            side: t.dir === 1 ? 'LONG' : 'SHORT',
            size: fmtSize(sizeUnits),
            entry: fmtPx(t.entryPx),
            exit: fmtPx(t.exitPx),
            pnl: fmtUsdSign(t.pnl),
            pnlPct: fmtPctSign(t.returnPct),
            pos: t.pnl >= 0,
            time: fmtTime(new Date(t.exitTs).toISOString()),
            open: false,
            entryTs: fmtTradeTs(t.entryTs),
            exitTs: fmtTradeTs(t.exitTs),
          }
        })

        const tickerForUi: TickerAsset[] = tickers.map(t => ({
          sym: t.short,
          price: fmtPx(t.price),
          delta: `${t.change >= 0 ? '+' : ''}${t.change.toFixed(2)}%`,
          pos: t.change >= 0,
        }))

        // Equity curve is now computed in the Hero component on each range
        // change — we just pass the raw trades + strategy base so it can
        // simulate "if you'd put $balanceUsd in N months ago, where would you
        // be now?" on the fly.
        const equityRangeLabel = portfolio.length > 0
          ? `${portfolio.length.toLocaleString()} backtest trades · ${fmtTime(new Date(portfolio[0].entryTs).toISOString())} – ${fmtTime(new Date(portfolio[portfolio.length - 1].exitTs).toISOString())}`
          : 'No backtest data — daemon may be warming up'

        // Win rate / streak — most recent strategy trades (last N from portfolio).
        const wr20 = winRateFromPortfolio(portfolio, 20)
        const wr50 = winRateFromPortfolio(portfolio, 50)
        const streak = streakFromPortfolio(portfolio)

        const stats = buildStats({
          unrealizedPnl,
          realizedPnl,
          totalReturnPct,
          openCount: openTrades.length,
          closedCount: portfolio.length,
          activated: !!botRes?.activated,
          openSide: openTrades[0]?.side,
          openSymbol: openTrades[0]?.symbol,
        })

        const data: StaxDashboardData = {
          btcPrice,
          balanceUsd: equity || startCapital,
          tierLabel,
          btcGoal,
          // Raw portfolio + base — Hero simulates the curve per range.
          portfolioTrades: portfolio.map(t => ({ exitTs: t.exitTs, pnl: t.pnl })),
          strategyBase: startCapital,
          equityRangeLabel,
          stats,
          positions,
          trades,
          // Live account-wide leverage = total open notional / equity. Falls
          // to 0 when flat. Bumps up as more legs open or pyramid scales them.
          leverage: equity > 0
            ? openTrades.reduce((s, t) => s + Number(t.size_usd || 0), 0) / equity
            : 0,
          leverageMax: TIER_GAUGE_MAX[tier] ?? 8,
          winRate20: wr20,
          winRate50: wr50,
          streak,
          ticker: tickerForUi,
          systemsOnline: true,
        }
        setState({ status: 'ready', data })
      } catch (e: any) {
        if (cancelled) return
        setState({ status: 'error', message: e?.message || 'Failed to load dashboard' })
      }
    }

    load()
    intervalId = window.setInterval(load, 30000)
    return () => { cancelled = true; if (intervalId !== null) window.clearInterval(intervalId) }
    // tickers dependency intentional — re-run when ticker prices update so
    // the ticker bar + open-position mark prices stay in sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(tickers.map(t => `${t.symbol}:${t.price.toFixed(2)}`))])

  return state
}
