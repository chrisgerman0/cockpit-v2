'use client'

import { useEffect, useState } from 'react'
import { Icons } from '@/components/cockpit/stax/Icons'
import type { StaxDashboardData, Position, Trade, CoinSym, TickerAsset, StatCardSpec } from '@/components/cockpit/stax/StaxDashboard'

// Coin symbol type alias used by the user-trade Position/Trade builders below.
type _CoinSymInternal = CoinSym
import { authedFetch, browserClient } from './api'
import { usePublicTickers, type PublicTicker } from './use-public-tickers'
import { fetchPortfolioTrades, fetchClosedTrades, normalizeTier, type PortfolioTrade, type Tier } from './use-portfolio-trades'

const V1_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'SUIUSDT', 'DOGEUSDT', 'LINKUSDT'] as const

// New schema (2026-05-10): 0.5× / 0.75× / 1.0×. Legacy 'bold' DB rows are
// normalized to 'aggressive' (same 1.0× sizing).
const TIER_LABEL: Record<Tier, string> = {
  conservative: 'Conservative tier · 0.5× of balance',
  moderate:     'Moderate tier · 0.75× of balance',
  aggressive:   'Aggressive tier · 1.0× of balance',
  kamikaze:     'Kamikaze tier · 1.25× of balance',
}

const TIER_LEV_CAP: Record<Tier, number> = {
  conservative: 4, moderate: 7, aggressive: 10, kamikaze: 14,
}

// Account-wide leverage gauge upper bound = theoretical peak leverage when
// all 7 legs are open AND each is pyramided (1.5× notional). Picked per
// tier so the gauge needle has room to grow but doesn't look empty.
//   Conservative 0.5×  × 7 × 1.5 = 5.25 → cap 6
//   Moderate     0.75× × 7 × 1.5 = 7.9  → cap 8
//   Aggressive   1.0×  × 7 × 1.5 = 10.5 → cap 12
const TIER_GAUGE_MAX: Record<Tier, number> = {
  conservative: 6, moderate: 8, aggressive: 12, kamikaze: 16,
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
  // Full assembled 16-asset basket. NEAR + OP added 2026-06-04 — they were
  // missing here, so symToCoin('NEARUSDT') fell through to the 'BTC' fallback
  // and the NEAR open position rendered the BTC icon. Keep in lock step with
  // CoinSym (StaxDashboard.tsx) + COIN_ICON_SRC + the publisher's ASSETS list.
  const KNOWN: ReadonlyArray<CoinSym> = [
    'BTC', 'ETH', 'SOL', 'XRP', 'SUI', 'DOGE', 'LINK',
    'ADA', 'AVAX', 'BNB', 'HYPE', 'GRAM', 'TRX', 'ZEC',
    'NEAR', 'OP', 'SEI', 'ONDO',
  ]
  return (KNOWN as readonly string[]).includes(s) ? s : 'BTC'
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
// Compact timestamp shown stacked under entry/exit prices in the Open
// Positions / Recent Trades tables. Year is intentionally omitted so the
// table fits its column without horizontal scroll on standard breakpoints.
// Format: "6 May, 13:14".
function fmtTradeTs(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return ''
  const d = new Date(ms)
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
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

// Streak built from REAL user trades + open positions, with hover labels.
// - Closed trades render as W/L dots (oldest→newest, last 10).
// - Open positions render as OW/OL dots (flashing) with current PnL.
// - recentLabels carries a tooltip per dot for the StreakCard's title attr.
// - Streak count uses only closed trades (open positions don't break streak).
function streakFromUser(closed: RawTrade[], openPositions: RawTrade[]): StaxDashboardData['streak'] {
  const closedSorted = [...closed].sort((a, b) => {
    const at = a.closed_at ? new Date(a.closed_at).getTime() : 0
    const bt = b.closed_at ? new Date(b.closed_at).getTime() : 0
    return at - bt  // oldest → newest
  })
  const opensSorted = [...openPositions].sort((a, b) => {
    const at = a.opened_at ? new Date(a.opened_at).getTime() : 0
    const bt = b.opened_at ? new Date(b.opened_at).getTime() : 0
    return at - bt
  })

  // Streak count — walk closed trades from newest backwards.
  let len = 0
  let kind: 'W' | 'L' | null = null
  for (let i = closedSorted.length - 1; i >= 0; i--) {
    const cur: 'W' | 'L' = Number(closedSorted[i].pnl_usd) > 0 ? 'W' : 'L'
    if (kind === null) { kind = cur; len = 1; continue }
    if (cur === kind) len++
    else break
  }

  // Dots: keep the last (10 - opensCount) closed dots, then append open dots.
  // Caps total at 10 + opens to leave breathing room when many positions open.
  const maxClosedDots = Math.max(5, 10 - opensSorted.length)
  const closedSlice = closedSorted.slice(-maxClosedDots)
  const dots: Array<'W' | 'L' | 'OW' | 'OL'> = []
  const labels: string[] = []
  // Tooltip is intentionally minimal: just COIN-SIDE (e.g. "BTC-LONG").
  // Pure ASCII so it renders consistently across fonts/browsers (unicode
  // arrows can fall back to '?' boxes in some monospace fonts).
  for (const t of closedSlice) {
    const pnl = Number(t.pnl_usd) || 0
    const sym = (t.symbol || '').replace('USDT', '')
    const side = (t.side || 'long').toUpperCase()
    dots.push(pnl > 0 ? 'W' : 'L')
    labels.push(`${sym}-${side}`)
  }
  for (const t of opensSorted) {
    const pnl = Number(t.pnl_usd) || 0
    const sym = (t.symbol || '').replace('USDT', '')
    const side = (t.side || 'long').toUpperCase()
    dots.push(pnl >= 0 ? 'OW' : 'OL')
    labels.push(`${sym}-${side}`)
  }

  if (!kind || len === 0) {
    // No closed trades — return empty count but keep open-position dots.
    return { value: opensSorted.length > 0 ? '—' : '–', sub: opensSorted.length > 0 ? `${opensSorted.length} open` : 'No trades yet', recent: dots, recentLabels: labels, isWin: true }
  }
  const sign = kind === 'W' ? '+' : '−'
  const word = kind === 'W' ? (len === 1 ? 'win' : 'wins') : (len === 1 ? 'loss' : 'losses')
  return { value: `${sign}${len}${kind}`, sub: `${len} consecutive ${word}`, recent: dots, recentLabels: labels, isWin: kind === 'W' }
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
  // Sort by exit_ts so `slice(-n)` returns the most-recent n closed trades
  // (the portfolio array can arrive in any order; don't trust insertion).
  const closed = trades.filter(t => !isOpenPortfolioTrade(t))
    .slice()
    .sort((a, b) => a.exitTs - b.exitTs)
  const recent = closed.slice(-n)
  let wins = 0, losses = 0
  for (const t of recent) (t.pnl > 0 ? wins++ : losses++)
  const total = wins + losses
  return { pct: total ? Math.round((wins / total) * 100) : 0, wins, losses }
}

function streakFromPortfolio(
  trades: PortfolioTrade[],
  tickerBySymbol: Record<string, { price: number } | undefined> = {},
): StaxDashboardData['streak'] {
  if (trades.length === 0) return { value: '–', sub: 'No trades yet', recent: [], recentLabels: [], isWin: true }

  // Mirror streakFromUser semantics so the strategy-fallback view has feature
  // parity with the user-trades view:
  //  - Sort closed by exit_ts oldest→newest (so closed[end] = newest)
  //  - Sort opens by entry_ts oldest→newest (multi-position support)
  //  - Generate per-dot labels (COIN-SIDE) for hover tooltip
  //  - Open dots (OW/OL) use LIVE ticker for color decisions when available,
  //    so the dashboard reads consistently with the backtest List of Trades
  //    (which uses the same live overlay). The published returnPct is from
  //    last-bar close and goes stale within minutes — color from that would
  //    diverge from what the OPEN row in the backtest list shows.
  const closedSorted = trades.filter(t => !isOpenPortfolioTrade(t))
    .slice()
    .sort((a, b) => a.exitTs - b.exitTs)
  const opensSorted = trades.filter(isOpenPortfolioTrade)
    .slice()
    .sort((a, b) => a.entryTs - b.entryTs)

  // Streak count — walk closed from newest backwards. Opens don't break streak.
  let len = 0
  let kind: 'W' | 'L' | null = null
  for (let i = closedSorted.length - 1; i >= 0; i--) {
    const cur: 'W' | 'L' = closedSorted[i].pnl > 0 ? 'W' : 'L'
    if (kind === null) { kind = cur; len = 1; continue }
    if (cur === kind) len++
    else break
  }

  // Dots: closed (most-recent maxClosedDots of them) then opens.
  // maxClosedDots leaves room for open dots — opens are the focal point.
  const maxClosedDots = Math.max(5, 10 - opensSorted.length)
  const closedSlice = closedSorted.slice(-maxClosedDots)
  const dots: Array<'W' | 'L' | 'OW' | 'OL'> = []
  const labels: string[] = []
  for (const t of closedSlice) {
    const sym = (t.symbol || '').replace('USDT', '')
    const side = t.dir === 1 ? 'LONG' : 'SHORT'
    dots.push(t.pnl > 0 ? 'W' : 'L')
    labels.push(`${sym}-${side}`)
  }
  for (const t of opensSorted) {
    const sym = (t.symbol || '').replace('USDT', '')
    const side = t.dir === 1 ? 'LONG' : 'SHORT'
    // Live-ticker-derived isWin so the OW/OL color matches what the user
    // sees in the backtest List of Trades opens row.
    const entry = t.entryPx
    const tickerPx = tickerBySymbol[t.symbol]?.price ?? 0
    const liveReturnPct = (tickerPx > 0 && entry > 0)
      ? ((tickerPx - entry) / entry) * 100 * t.dir
      : (t.returnPct ?? 0)
    const isWin = liveReturnPct >= 0
    dots.push(isWin ? 'OW' : 'OL')
    labels.push(`${sym}-${side}`)
  }

  if (!kind || len === 0) {
    return {
      value: opensSorted.length > 0 ? '—' : '–',
      sub: opensSorted.length > 0 ? `${opensSorted.length} open` : 'No trades yet',
      recent: dots, recentLabels: labels, isWin: true,
    }
  }
  const sign = kind === 'W' ? '+' : '−'
  const word = kind === 'W' ? (len === 1 ? 'win' : 'wins') : (len === 1 ? 'loss' : 'losses')
  return {
    value: `${sign}${len}${kind}`,
    sub: `${len} consecutive ${word}`,
    recent: dots, recentLabels: labels, isWin: kind === 'W',
  }
}

function buildStats(opts: {
  unrealizedPnl: number
  realizedPnl: number
  totalReturnPct: number
  openCount: number
  closedCount: number
  activated: boolean
  openLegs?: Array<{ symbol: string; side: 'long' | 'short' }>
}): StatCardSpec[] {
  const { unrealizedPnl, realizedPnl, totalReturnPct, openCount, closedCount, activated, openLegs = [] } = opts
  // Bot Status — handle 0, 1, or many legs across BTC/ETH/SOL/XRP/SUI with
  // mixed long/short directions. Examples:
  //   0 legs (active):     "Active" / "Watching"
  //   1 leg:               "LONG" / "BTC"
  //   3 legs same side:    "3 LONG" / "BTC · SOL · XRP"
  //   mixed sides:         "MIXED" / "2L · 1S"
  const longCount = openLegs.filter(l => l.side === 'long').length
  const shortCount = openLegs.filter(l => l.side === 'short').length
  const allLong = openCount > 0 && shortCount === 0
  const allShort = openCount > 0 && longCount === 0
  const mixed = longCount > 0 && shortCount > 0
  const symList = openLegs.map(l => l.symbol.replace('USDT', '')).join(' · ')
  const botStatusValue = openCount === 0
    ? (activated ? <span className="pos-text"><span className="dot-live" />Active</span> : <span style={{ color: 'var(--muted)' }}>Off</span>)
    : mixed
      ? <span className="pos-text"><span className="dot-live" />MIXED</span>
      : <span className={allShort ? 'neg-text' : 'pos-text'}><span className="dot-live" />{openCount > 1 ? `${openCount} ` : ''}{allShort ? 'SHORT' : 'LONG'}</span>
  const botStatusSub = openCount === 0
    ? (activated ? 'Watching' : 'Activate to start')
    : mixed
      ? `${longCount}L · ${shortCount}S — ${symList}`
      : symList
  return [
    {
      label: 'Bot Status',
      icon: Icons.Robot,
      value: botStatusValue,
      sub: botStatusSub,
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
  | { status: 'no-keys'; data: StaxDashboardData }
  | { status: 'no-bot'; data: StaxDashboardData }
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
        const { data: { session }, error: sessionError } = await sb.auth.getSession()
        if (!session || sessionError) { if (!cancelled) setState({ status: 'unauthenticated' }); return }

        // Pull the mission target from user_metadata. Settings → Profile saves
        // it via supabase.auth.updateUser; reading from getUser ensures we
        // always see the latest value (no extra API call needed).
        const { data: { user: authUser } } = await sb.auth.getUser()
        const missionTarget = Number((authUser?.user_metadata as any)?.mission_target_btc)
        const btcGoalTarget = Number.isFinite(missionTarget) && missionTarget > 0 ? missionTarget : 1

        const [botRes, balanceRes, userTradesRes] = await Promise.all([
          authedFetch<BotConfigResp>('/api/bot-activate').catch(() => null),
          authedFetch<BalanceResp>('/api/balance').catch((e: Error) => ({ error: e.message } as BalanceResp)),
          // Bitget-sourced (see use-live-trading-data.tsx for rationale).
          // limit=500 (not 50): /api/trades-live divides the limit across the 19
          // V1 symbols (route.ts getPositionHistory ⌈limit/19⌉ per symbol), so
          // limit=50 caps each symbol at 3 closed rows → busy symbols get truncated,
          // undercounting realized PnL / return / closed-count vs the Live Trading
          // page (which uses 500). Match it so both read the SAME full closed set.
          authedFetch<{ trades: RawTrade[] }>('/api/trades-live?limit=500').catch(() => ({ trades: [] as RawTrade[] })),
        ])
        if (cancelled) return

        // Detect the user's setup state but DON'T short-circuit. The dashboard
        // pre-activation should still render a "strategy preview" so the user
        // can see the strategy's backtest curve, win rate, recent trades, etc.
        // before they connect keys. The OnboardingBanner above the dashboard
        // tells them what to do next. Without this, brand-new users saw a
        // bare CenterMessage which made the site feel empty and untrustworthy.
        const noKeys = !!(balanceRes && 'error' in balanceRes && /no api keys/i.test(balanceRes.error || ''))
        const noBot = !botRes?.activated || !botRes?.config
        const cfg = botRes?.config

        // Default tier for the preview when the user hasn't picked one yet.
        // Aggressive shows the most attractive backtest, but we use conservative
        // here so the preview matches what a default new-account experience
        // would actually be (and the user can preview other tiers from the
        // Backtesting page).
        const tier = cfg ? normalizeTier(cfg.tier || cfg.preset) : 'conservative'
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
        // Recent Trades list (new-user backtest fallback) sources the FORWARD
        // closed history (liveref closed-trades.json) so it shows the strategy's
        // RECENT closes — the frozen `portfolio` set ends at the locked backtest
        // window (~2026-05-29), which made Recent Trades read as stale May rows.
        // Headline metrics (return/win-rate/streak/equity) stay on frozen `portfolio`.
        const fwdClosed = await fetchClosedTrades(tier).catch(() => [] as PortfolioTrade[])
        if (cancelled) return

        // Realised pnl + return % — USER's account, not the backtest.
        // CRITICAL: Total Return is REALIZED-ONLY (closed trades vs activation
        // balance). Do NOT include unrealized PnL or current equity — those
        // would make the card flicker on every tick as mark prices move.
        // Matches Live Trading page's realizedPct formula. Open positions
        // contribute to Unrealized PnL card, never here.
        const userClosedTrades = userTrades.filter(t => t.status === 'closed')
        const realizedPnl = userClosedTrades.reduce((s, t) => s + (Number(t.pnl_usd) || 0), 0)
        const startCapital = 10000  // strategy account base — kept for equity-curve simulation only
        const userActivationBalance = Number((cfg as { activation_balance?: number })?.activation_balance) || 0
        const userBaseline = userActivationBalance > 0 ? userActivationBalance : startCapital
        const totalReturnPct = userBaseline > 0
          ? (realizedPnl / userBaseline) * 100
          : 0

        const tickerBySymbol: Record<string, PublicTicker | undefined> = {}
        tickers.forEach(t => { tickerBySymbol[t.symbol] = t })
        const btcPrice = tickerBySymbol['BTCUSDT']?.price || 0
        // Raw equity-in-BTC; the dashboard divides by btcGoalTarget to compute
        // progress %. Don't clamp here — let the UI decide based on target.
        const btcGoal = btcPrice > 0 ? equity / btcPrice : 0

        let positions: Position[] = openTrades.map(t => {
          const entry = Number(t.entry_price || 0)
          const sizeUsd = Number(t.size_usd || 0)
          const sizeUnits = entry > 0 ? sizeUsd / entry : 0
          const dir = t.side === 'long' ? 1 : -1
          // Mark/PnL preference order:
          //   1. Public ticker (most live, updates client-side)
          //   2. Bitget-sourced pnl from /api/trades-live (already mark-priced
          //      server-side using Bitget's markPrice — accurate to within
          //      the cache TTL)
          //   3. Entry price fallback (zero PnL — never used in practice)
          // Without this fallback chain, positions would show $0/$0 for the
          // first ~5s after page load while the public ticker WS is still
          // connecting, even though /api/trades-live already returned a
          // valid mark-priced PnL. Now that initial render uses the
          // server-computed PnL.
          const tickerPx = tickerBySymbol[t.symbol]?.price || 0
          const apiPnlUsd = Number(t.pnl_usd) || 0
          const mark = tickerPx > 0 ? tickerPx : entry
          const pnlUsd = tickerPx > 0
            ? (tickerPx - entry) * sizeUnits * dir
            : apiPnlUsd
          const pnlPct = entry > 0 && tickerPx > 0
            ? ((tickerPx - entry) / entry) * 100 * dir
            : Number(t.pnl_pct) || 0
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
            // Raw fields for the page-level live ticker overlay to use.
            entryNum: entry,
            sizeUnits,
            dir: dir as 1 | -1,
          }
        })

        // Strategy-positions FALLBACK (pre-activation only): when a
        // not-yet-activated user has no real Bitget positions, surface
        // what the strategy is currently long/short on so the dashboard
        // isn't empty. Sourced from portfolio-trades.json `reason: 'eod'`
        // entries (strategy's still-open positions at end-of-data).
        //
        // 2026-05-26 critical guard: only fall back when the user is NOT
        // activated. If the user IS activated AND has zero positions, the
        // honest display is "no open positions" — NOT "here are 4 phantom
        // strategy positions that aren't yours". Previously the fallback
        // fired any time openTrades was empty, including when /api/trades-
        // live returned empty due to a transient Bitget API issue. Chris
        // saw 4 phantom positions (SOL/AVAX/TON/TRX) on the Dashboard
        // while only TRX was his real position.
        if (positions.length === 0 && noBot) {
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
            const tickerPx = tickerBySymbol[t.symbol]?.price || 0
            const mark = tickerPx > 0 ? tickerPx : entry
            // Strategy's notional was sized for $10k base — scale to user's balance
            const sizeUsd = (t.notional || 0) * scale
            const sizeUnits = entry > 0 ? sizeUsd / entry : 0
            const dir = t.dir
            // Prefer live ticker for PnL; fall back to published returnPct
            // (last-bar close at publisher run time) when ticker hasn't
            // connected yet. Without the returnPct fallback, all 4 strategy-
            // open positions render +$0.00 / +0.00% for the first ~5s of
            // page load until the public ticker WS frame arrives — looks
            // broken.
            const pnlUsd = tickerPx > 0
              ? (tickerPx - entry) * sizeUnits * dir
              : (t.returnPct ?? 0) / 100 * sizeUsd
            const pnlPct = entry > 0 && tickerPx > 0
              ? ((tickerPx - entry) / entry) * 100 * dir
              : (t.returnPct ?? 0)
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
              // Raw fields for the page-level live ticker overlay (same
              // pattern as user-trades positions above). Without these,
              // the render-time overlay can't recompute PnL on each
              // ticker frame and the cell stays frozen.
              entryNum: entry,
              sizeUnits,
              dir: dir as 1 | -1,
            }
          })
        }

        // Recent Trades widget — prefer the user's own closed trades. When
        // the user has none (brand-new account, preview state, or just
        // activated and hasn't traded yet) fall back to the strategy's
        // recent backtest trades so the dashboard never shows an empty
        // table next to a populated equity curve. The widget badges
        // strategy-sourced rows so the UI can flag the difference.
        const closedSorted = [...userClosedTrades].sort((a, b) => {
          const at = a.closed_at ? new Date(a.closed_at).getTime() : 0
          const bt = b.closed_at ? new Date(b.closed_at).getTime() : 0
          return bt - at  // newest first
        })
        const trades: Trade[] = closedSorted.length > 0 ? closedSorted.slice(0, 5).map(t => {
          const entry = Number(t.entry_price) || 0
          const exit = Number(t.exit_price) || 0
          const sizeUsd = Number(t.size_usd) || 0
          const sizeUnits = entry > 0 ? sizeUsd / entry : 0
          const pnl = Number(t.pnl_usd) || 0
          const pnlPct = Number(t.pnl_pct) || 0
          const entryTsMs = t.opened_at ? new Date(t.opened_at).getTime() : null
          const exitTsMs = t.closed_at ? new Date(t.closed_at).getTime() : null
          return {
            sym: symToCoin(t.symbol),
            pair: t.symbol,
            side: t.side === 'long' ? 'LONG' : 'SHORT',
            size: fmtSize(sizeUnits),
            entry: fmtPx(entry),
            exit: fmtPx(exit),
            pnl: fmtUsdSign(pnl),
            pnlPct: fmtPctSign(pnlPct),
            pos: pnl >= 0,
            time: fmtTime(t.closed_at),
            open: false,
            entryTs: fmtTradeTs(entryTsMs),
            exitTs: fmtTradeTs(exitTsMs),
          }
        }) : [...(fwdClosed.length > 0 ? fwdClosed : portfolio)]
          // Recent Trades widget = CLOSED trades only. Use the same
          // open-trade detector that powers the Open Positions fallback
          // so both sides agree on what "open" means. Without this,
          // backtest snapshots (reason='eod' raw, renamed to 'open' for
          // customers) leak into Recent Trades with their last-bar close
          // masquerading as an exit price, duplicating what's already
          // shown in Open Positions.
          .filter(p =>
            !isOpenPortfolioTrade(p) &&
            p.reason !== 'eod_pyr' && p.reason !== 'eod_pyr50' && p.reason !== 'scalp_eod'
          )
          .sort((a, b) => b.exitTs - a.exitTs)
          .slice(0, 5)
          .map(p => {
            const sizeUnits = p.entryPx > 0 ? p.notional / p.entryPx : 0
            return {
              sym: symToCoin(p.symbol),
              pair: p.symbol,
              side: (p.dir === 1 ? 'LONG' : 'SHORT') as 'LONG' | 'SHORT',
              size: fmtSize(sizeUnits),
              entry: fmtPx(p.entryPx),
              exit: fmtPx(p.exitPx),
              pnl: fmtUsdSign(p.pnl),
              pnlPct: fmtPctSign(p.returnPct),
              pos: p.pnl >= 0,
              time: fmtTime(new Date(p.exitTs).toISOString()),
              open: false,
              entryTs: fmtTradeTs(p.entryTs),
              exitTs: fmtTradeTs(p.exitTs),
              fromStrategy: true,
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

        // Win rate / streak — prefer USER trades; when the user has none
        // (preview, brand-new active account, etc.) fall back to the strategy
        // backtest so the dashboard reads as full. Strategy trades are
        // pre-filtered for eod markers by fetchPortfolioTrades, so the
        // counts here are real closed-trade counts.
        const useStrategyForStats = userClosedTrades.length === 0
        const wr20 = useStrategyForStats
          ? winRateFromPortfolio(portfolio, 20)
          : buildWinRate(userTrades, 20)
        const wr50 = useStrategyForStats
          ? winRateFromPortfolio(portfolio, 50)
          : buildWinRate(userTrades, 50)
        const streak = useStrategyForStats
          ? streakFromPortfolio(portfolio, tickerBySymbol)
          : streakFromUser(userClosedTrades, openTrades)

        const stats = buildStats({
          unrealizedPnl,
          realizedPnl,
          totalReturnPct,
          openCount: openTrades.length,
          closedCount: userClosedTrades.length,  // user's real closed trades, not backtest
          activated: !!botRes?.activated,
          openLegs: openTrades.map(t => ({ symbol: t.symbol, side: t.side as 'long' | 'short' })),
        })

        const data: StaxDashboardData = {
          btcPrice,
          balanceUsd: equity || startCapital,
          tierLabel,
          btcGoal,
          btcGoalTarget,
          // "Preview" means the BALANCE shown is the strategy's notional base
          // rather than a real exchange figure. Once API keys are connected,
          // the balance is real even if the bot hasn't been activated yet —
          // so we only flag preview on noKeys. The dashboard banner still
          // tells the user to set up the bot via the 3-step strip.
          isPreview: noKeys,
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
        // status is still surfaced so the caller (DashboardLive) and the
        // OnboardingBanner know whether this is a preview render. Data is
        // always populated for these states now, so DashboardLive renders
        // the full StaxDashboardContent in every case — banner sits on top.
        const previewStatus: StaxLoadState['status'] = noKeys ? 'no-keys' : noBot ? 'no-bot' : 'ready'
        setState({ status: previewStatus, data } as StaxLoadState)
      } catch (e: any) {
        if (cancelled) return
        setState({ status: 'error', message: e?.message || 'Failed to load dashboard' })
      }
    }

    load()
    intervalId = window.setInterval(load, 30000)
    return () => { cancelled = true; if (intervalId !== null) window.clearInterval(intervalId) }
    // CRITICAL: do NOT depend on ticker prices here. Bitget WebSocket
    // emits ticker updates several times per second; if this effect
    // re-runs on each tick, every ticker change triggers a full data
    // reload (3 authed API calls + a 4 MB portfolio JSON fetch).
    // Result: dashboard hangs for minutes under live ticker stream
    // (see commit log for the fix story). Mark prices in open
    // positions are now overlaid via tickerBySymbol in render — see
    // the StaxDashboard component, which re-renders on ticker tick
    // without re-fetching anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return state
}
