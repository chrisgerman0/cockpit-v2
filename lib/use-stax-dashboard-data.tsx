'use client'

import { useEffect, useState, useRef } from 'react'
import { PHASE_H_BASKET } from './phase-h-basket'
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
  /** ISO moment the CURRENT wizard configuration became effective. See the equity-curve note. */
  effective_from?: string | null
  effective_from_source?: string | null
  activation_balance_source?: string | null
}

function symToCoin(sym: string): CoinSym {
  const s = sym.replace('USDT', '') as CoinSym
  // Full assembled 16-asset basket. NEAR + OP added 2026-06-04 — they were
  // missing here, so symToCoin('NEARUSDT') fell through to the 'BTC' fallback
  // and the NEAR open position rendered the BTC icon. Keep in lock step with
  // CoinSym (StaxDashboard.tsx) + COIN_ICON_SRC + the publisher's ASSETS list.
  // 2026-09-03: this was a third hardcoded 19-coin copy, and an unknown coin fell back to the
  // BTC icon — so a position on any of the eleven coins missing from it showed the customer a
  // BITCOIN logo on, say, an AAVE trade. Driven by the generated basket now; the fallback is only
  // reached for something genuinely outside the book.
  const KNOWN: readonly string[] = PHASE_H_BASKET
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

// 2026-09-02: the live track record is pinned to the k54_bounded re-lock. The API
// filters the trades to that epoch; this carries the label so the page can SAY so —
// a zero on day one must read as a fresh start, not a broken panel.
type TrackRecord = {
  epoch_ms: number
  epoch_iso: string
  epoch_label: string
  basket: string
  hidden_count: number
  note: string
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
  // ── 2026-09-03: A FAILED POLL USED TO BLANK THE SCREEN ────────────────────────────────────
  // Every poll did `.catch(() => ({ trades: [] }))`, turning ANY transient failure — and
  // /api/trades-live verifies the session against Supabase, which intermittently hits a 10s
  // connect timeout — into a confident, fabricated "you have no trades". The dashboard then
  // rendered "No open position" and 0.00x leverage while Chris held a live ONDO short, until the
  // next poll happened to succeed. That is the flicker.
  // A failed poll is an ABSENCE OF NEWS, not news that the book is empty. Hold the last good
  // payload instead; only an genuinely empty first load shows empty.
  const lastGoodTrades = useRef<{ trades: RawTrade[]; track_record?: TrackRecord } | null>(null)
  const tickers = usePublicTickers(30000)

  useEffect(() => {
    let cancelled = false
    let intervalId: number | null = null

    async function load() {
      try {
        const sb = browserClient()
        // 2026-09-22: this used to `return` on a missing session, so when Supabase Auth hung the
        // hook never issued a single API call and the dashboard sat at $0.00. A missing Supabase
        // session is NOT proof of being signed out — the locally-verified admin cookie may still
        // authenticate. Let the SERVER decide: authedFetch now sends credentials and surfaces a
        // real 401 as NOT_AUTHENTICATED, which is handled below.
        // ── NOTHING ON THE DATA PATH MAY AWAIT SUPABASE UNBOUNDED (2026-09-22) ──────────────
        // These two were raw client calls. `.catch()` catches a REJECTION; it does not rescue a
        // HANG, and gotrue was hanging — the console showed
        //   `Lock "lock:sb-…-auth-token" was not released within 5000ms`
        // so the hook blocked here and never reached a single fetch. Measured in Chris's own
        // browser at the time: /api/balance and /api/trades-live BOTH returned 200 with real data,
        // while the page sat on "Loading" and $0.00 — the data was available and never requested.
        // Both are now raced against a short timeout and fall back to harmless defaults. Neither
        // value gates the account data: `session` is informational and the mission target has a
        // default of 1 BTC.
        const bounded = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
          Promise.race([
            p.catch(() => fallback),
            new Promise<T>(res => setTimeout(() => res(fallback), ms)),
          ])

        const sessRes = await bounded(
          sb.auth.getSession() as unknown as Promise<{ data: { session: unknown | null } }>,
          2000, { data: { session: null } })
        const session = sessRes?.data?.session ?? null

        const userRes = await bounded(
          sb.auth.getUser() as unknown as Promise<{ data: { user: { user_metadata?: Record<string, unknown> } | null } }>,
          2000, { data: { user: null } })
        const authUser = userRes?.data?.user ?? null
        const missionTarget = Number((authUser?.user_metadata as any)?.mission_target_btc)
        const btcGoalTarget = Number.isFinite(missionTarget) && missionTarget > 0 ? missionTarget : 1

        // Track whether the SERVER actually rejected us. A swallowed NOT_AUTHENTICATED must not
        // become `balance = 0` — that is the fabricated-$0 failure this whole change exists to
        // stop. We now distinguish "rejected" from "could not ask" from "answered".
        let sawUnauthenticated = false
        let sawUpstreamDown = false
        const classify = (e: Error) => {
          const m = String(e?.message || e)
          if (/NOT_AUTHENTICATED/.test(m)) sawUnauthenticated = true
          else if (/unavailable|upstream|503/i.test(m) || e?.name === 'AuthUnavailableError'
                   || e?.name === 'UpstreamUnavailableError') sawUpstreamDown = true
          return m
        }

        const [botRes, balanceRes, userTradesRes] = await Promise.all([
          authedFetch<BotConfigResp>('/api/bot-activate').catch((e: Error) => { classify(e); return null }),
          authedFetch<BalanceResp>('/api/balance').catch((e: Error) => ({ error: classify(e) } as BalanceResp)),
          // Bitget-sourced (see use-live-trading-data.tsx for rationale).
          // limit=500 (not 50): /api/trades-live divides the limit across the 19
          // V1 symbols (route.ts getPositionHistory ⌈limit/19⌉ per symbol), so
          // limit=50 caps each symbol at 3 closed rows → busy symbols get truncated,
          // undercounting realized PnL / return / closed-count vs the Live Trading
          // page (which uses 500). Match it so both read the SAME full closed set.
          authedFetch<{ trades: RawTrade[]; track_record?: TrackRecord }>('/api/trades-live?limit=500')
            .then(r => { lastGoodTrades.current = r; return r })
            .catch((e: Error) => { classify(e); return lastGoodTrades.current ?? ({ trades: [] as RawTrade[], track_record: undefined }) }),
        ])
        if (cancelled) return

        // A REJECTION IS A SIGN-OUT; AN OUTAGE IS NOT, AND NEITHER IS EVER $0.
        // Without this, a 401 fell through to `equity = Number(balance?.equity || 0)` and the
        // dashboard rendered $0.00 over a live account — indistinguishable from a real zero.
        if (sawUnauthenticated && !balanceRes?.equity) {
          if (!cancelled) setState({ status: 'unauthenticated' })
          return
        }
        // `lastGoodTrades.current` is set even when a response was EMPTY, so testing it for
        // truthiness let an empty cache masquerade as good data and suppressed this branch —
        // leaving $0.00 on screen. Require actual trades.
        const haveGoodCache = (lastGoodTrades.current?.trades?.length ?? 0) > 0
        if (sawUpstreamDown && !balanceRes?.equity && !haveGoodCache) {
          if (!cancelled) setState({ status: 'error',
            message: 'Upstream authentication is unavailable. Your data is not being shown rather '
                   + 'than shown as zero. Retrying automatically.' })
          return
        }

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
        // When the bot config could not be read (Supabase down), DO NOT present the fallback tier
        // as fact — it rendered "Conservative tier · 0.5× of balance" over an Aggressive account.
        const configUnavailable = !cfg && (sawUpstreamDown || (botRes === null))
        const tierLabel = configUnavailable
          ? 'Tier unavailable — upstream down'
          : (TIER_LABEL[tier] ?? TIER_LABEL.conservative)

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
        // 2026-09-26 — A FAILED READ AND AN EMPTY BOOK ARE DIFFERENT FACTS. Both of these used to
        // collapse to `[]`, and the equity card then drew a GENERATED curve over the top of it. The
        // flags below travel to the Hero as `equityStatus`, so a 500 renders as "could not load"
        // and a genuinely new account renders as "no closed trades yet".
        let equityReadFailed = false
        let equityReadError: string | undefined
        const portfolio = await fetchPortfolioTrades(tier).catch((e: Error) => {
          equityReadFailed = true
          equityReadError = `Strategy trade history could not be read (${e?.message || 'fetch failed'}).`
          return [] as PortfolioTrade[]
        })
        // Recent Trades list (new-user backtest fallback) sources the FORWARD
        // closed history (liveref closed-trades.json) so it shows the strategy's
        // RECENT closes — the frozen `portfolio` set ends at the locked backtest
        // window (~2026-05-29), which made Recent Trades read as stale May rows.
        // Headline metrics (return/win-rate/streak/equity) stay on frozen `portfolio`.
        const fwdClosed = await fetchClosedTrades(tier).catch((e: Error) => {
          equityReadFailed = true
          equityReadError = equityReadError
            || `Closed-trade history could not be read (${e?.message || 'fetch failed'}).`
          return [] as PortfolioTrade[]
        })
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
        // 2026-09-02 — THE FALLBACK MUST NOT FIRE FOR A LIVE ACCOUNT WITH A CLEAN SHEET.
        // "the user has none" used to mean brand-new or preview. Since the track record was
        // pinned to the k54 re-lock it ALSO means "active, paying, and simply hasn't traded
        // yet" — and the widget then showed five of the STRATEGY's own trades next to stat
        // cards reading "No trades yet" and "Total Return +0.00%". They look like the user's
        // trades and they are not. Chris caught it on his own dashboard.
        // Fall back ONLY in the preview state (no keys / no bot), where there is no account to
        // report on. A live account shows its own record, empty if that is the truth.
        const isPreviewState = noKeys || noBot
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
        // Same rule as Recent Trades above: a LIVE account with a clean sheet reports its own
        // (empty) numbers. Only a preview account borrows the strategy's.
        const useStrategyForStats = isPreviewState && userClosedTrades.length === 0
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

        // The user's OWN realised trades, oldest-first, for the real equity curve. Never the
        // strategy's book: `pnl_usd` and `closed_at` come from the authenticated user's ledger.
        // ── THE CURVE BELONGS TO THE CURRENT CONFIGURATION (2026-09-26) ────────────────────────
        // It used to start at the activation BALANCE and then plot every trade the account had
        // ever closed. Chris's account showed a curve starting at $5,000 against a balance of
        // ~$8,417 — the start came from one configuration and the history from all of them, and
        // the ending basis reconciled with nothing.
        //
        // The curve now begins at the equity recorded when the LATEST wizard settings became
        // effective and contains only trades OPENED under those settings. A position opened
        // before that moment and closed after it is a CARRIED position: it is not this
        // configuration's performance, so it is excluded from the curve and counted separately
        // rather than silently dropped. When the effective moment is unknown the curve is not
        // guessed — `equityStatus` goes to 'empty' with the reason, because a curve over the wrong
        // period is worse than no curve.
        const effFromMs = botRes?.effective_from ? Date.parse(botRes.effective_from) : NaN
        const haveEff = Number.isFinite(effFromMs)
        const closedWithTs = userClosedTrades
          .filter(t => t.closed_at)
          .map(t => ({
            exitTs: new Date(t.closed_at as string).getTime(),
            openTs: t.opened_at ? new Date(t.opened_at as string).getTime() : NaN,
            pnl: Number(t.pnl_usd) || 0,
          }))
          .filter(t => Number.isFinite(t.exitTs) && t.exitTs > 0)
          .sort((a, b) => a.exitTs - b.exitTs)
        // opened under the current settings
        const underCurrent = haveEff
          ? closedWithTs.filter(t => Number.isFinite(t.openTs) && t.openTs >= (effFromMs as number))
          : []
        // opened before, closed after — carried across the settings change
        const carried = haveEff
          ? closedWithTs.filter(t => Number.isFinite(t.openTs) && t.openTs < (effFromMs as number)
                                     && t.exitTs >= (effFromMs as number))
          : []
        // a row with no opened_at cannot be attributed to a configuration; it is named, not binned
        const unattributable = closedWithTs.filter(t => !Number.isFinite(t.openTs))
        const realEquityTrades = underCurrent.map(t => ({ exitTs: t.exitTs, pnl: t.pnl }))

        const data: StaxDashboardData = {
          trackRecord: userTradesRes?.track_record,
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
          // 2026-07-06 equity-curve fix. equityTrades = FORWARD closed set (fwdClosed,
          // extends to TODAY 2026-07-06) so every range window [today−N, today] ends now
          // instead of at the frozen backtest pin (~2026-05-29 → the curve froze at May).
          // equityBase = the curve's STARTING balance: the connected user's wizard initial
          // capital (activation_balance) or $10k for a new/preview user — NOT the current
          // account balance (which made the curve start at "now" instead of at inception).
          // 2026-09-22 REAL-ACCOUNT EQUITY. This used to be `fwdClosed` — the LIVEREF closed
          // book, i.e. the STRATEGY's canonical trades, not this user's. The caption under the
          // chart reads "Your $X balance", so the dashboard presented the strategy's performance
          // as the user's own: Chris's account showed a curve climbing to ~$48k while his balance
          // was $8,230 and realised PnL was -$5,711.
          // A user WITH real closed trades now gets ONLY their own. A user with none keeps the
          // illustrative fallback, and `equityIsReal` tells the UI to label it as such.
          // surfaced in the UI so a degraded read is never mistaken for a healthy one
          degraded: !!(balanceRes as { degraded?: boolean })?.degraded
                    || !!(userTradesRes as { degraded?: boolean })?.degraded
                    || configUnavailable,
          degradedWarning: (balanceRes as { warning?: string })?.warning
                    || (userTradesRes as { warning?: string })?.warning
                    || (configUnavailable ? 'Bot configuration is unreadable while the upstream is down.' : undefined),
          balanceSource: (balanceRes as { source?: string })?.source,
          balanceAgeSeconds: (balanceRes as { ageSeconds?: number })?.ageSeconds,
          equityTrades: realEquityTrades,
          equityIsReal: realEquityTrades.length > 0,
          equityEffectiveFrom: botRes?.effective_from ?? null,
          equityEffectiveFromSource: botRes?.effective_from_source ?? null,
          equityBaseSource: botRes?.activation_balance_source ?? null,
          equityCarriedCount: carried.length,
          equityCarriedPnl: Math.round(carried.reduce((a, t) => a + t.pnl, 0) * 100) / 100,
          equityUnattributableCount: unattributable.length,
          equityExcludedBeforeEffective: haveEff
            ? closedWithTs.length - underCurrent.length - carried.length - unattributable.length
            : closedWithTs.length,
          // ORDER MATTERS: a read failure outranks an empty book. Reporting "no trades yet" on a
          // 503 is the fabricated-zero failure wearing friendlier words.
          // ORDER MATTERS: a read failure outranks an unknown effective date, which outranks an
          // empty book. Each is a different fact and none of them is a zero.
          equityStatus: equityReadFailed && realEquityTrades.length === 0 && portfolio.length === 0
            ? 'error'
            : (!haveEff && closedWithTs.length > 0
                ? 'error'
                : (realEquityTrades.length === 0 && portfolio.length === 0 ? 'empty' : 'ok')),
          equityError: equityReadFailed
            ? equityReadError
            : (!haveEff && closedWithTs.length > 0
                ? 'The moment your current bot settings became effective could not be read, so the '
                  + 'curve cannot be bounded to them. Showing no curve rather than one over the '
                  + 'wrong period.'
                : undefined),
          equityRealTradeCount: realEquityTrades.length,
          equityBase: userBaseline,
          strategyBase: startCapital,
          equityRangeLabel,
          stats,
          positions,
          // 2026-09-02: a LIVE account with a clean sheet shows its own (empty) record. The
          // strategy fallback above is for the PREVIEW state only — see the note at
          // isPreviewState. Without this the widget showed five strategy trades beside stat
          // cards reading "No trades yet".
          trades: (!isPreviewState && closedSorted.length === 0) ? [] : trades,
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
