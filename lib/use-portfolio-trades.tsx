'use client'

import { useEffect, useState } from 'react'

/**
 * Strategy backtest trade ledger, sourced from the static JSON the
 * multi-asset-backtest daemon publishes every 60s. Same data source the
 * Backtesting page reads, so Recent Trades on the Dashboard and Trade
 * History on Live Trading mirror what the strategy is doing — not the
 * user's personal Bitget executions.
 *
 * Strategy mechanics, indicator names, thresholds, and entry/exit logic
 * are deliberately NOT documented in this file. They live in the admin
 * spec page only. Don't reintroduce them here — this comment ships in
 * source maps + can be inspected by anyone with DevTools.
 *
 * Tier maps to the right file (after 2026-05-10 schema cutover):
 *   Conservative (0.5×) → /data/strategies/satoshi-stacker/portfolio-trades.json
 *   Moderate (0.75×)    → tiers/moderate/portfolio-trades.json
 *   Aggressive (1.0×)   → tiers/aggressive/portfolio-trades.json (overwrites old 1.5×)
 * Legacy DB tier='bold' is normalized to 'aggressive' on read (same sizing).
 */

export type PortfolioTrade = {
  dir: 1 | -1
  pnl: number
  entryTs: number
  exitTs: number
  reason: string
  pyramided: boolean
  pyramid21Added?: boolean
  pyramid50Added?: boolean
  entryPx: number
  exitPx: number
  notional: number
  mfePct: number
  returnPct: number
  tierMult: number
  displayReason: string
  symbol: string         // e.g. BTCUSDT
  type: string           // 'hb'
  source?: string
  // ADMIN-ONLY provenance. Present only when the trade was fetched via
  // /api/admin/portfolio-trades. The public path strips this field server-
  // side, so non-admin callers never see it. Strategy IP — never render
  // unless caller verified isAdmin.
  cfg_sid?: string
}

export type Tier = 'conservative' | 'moderate' | 'aggressive'
// Legacy DB values may still carry 'bold' — normalize before any tier read.
export type LegacyTier = Tier | 'bold'

export function normalizeTier(raw: string | undefined | null): Tier {
  const v = (raw || '').toLowerCase()
  if (v === 'bold') return 'aggressive'   // both at 1.0× — same effective sizing
  if (v === 'conservative' || v === 'moderate' || v === 'aggressive') return v
  return 'conservative'
}

function pathForTier(tier: Tier): string {
  // 2026-05-21: cutover from V1 satoshi-stacker to Phase H. The V1 publisher
  // pipeline was deleted (see archive/v1-satoshi-stacker-deprecated-2026-05-12/
  // HANDOVER.md). Trade ledger remains [] until the shadow engine (Phase B)
  // ships — stats render fine from portfolio-stats.json regardless.
  if (tier === 'conservative') return '/data/strategies/phase-h/portfolio-trades.json'
  return `/data/strategies/phase-h/tiers/${tier}/portfolio-trades.json`
}

// Tiny in-memory cache shared across hooks — daemon refreshes every 60s, so
// 60s here is fine. Avoids re-downloading 4.5MB on every component mount.
// We cache the RAW set (closed + open eod markers) and let callers choose
// which view they want via the `includeOpen` flag.
type CacheEntry = { fetchedAt: number; raw: PortfolioTrade[] }
const cache = new Map<Tier, CacheEntry>()
const CACHE_MS = 60_000

/**
 * Returns true for the "open trade" placeholder rows the daemon writes at
 * end-of-day. Their pnl is a mark-to-market against the strategy's
 * compounded-equity notional (e.g. SUI eod notional = $597M, pnl = -$7M
 * because the strategy's internal compounded equity for SUI alone is huge).
 * Aggregated metrics MUST exclude these — including them distorts returns,
 * sharpe, drawdown, monthly returns. Callers that want to surface them as
 * "currently open" in a trade list set includeOpen=true and visually flag
 * the rows.
 */
export function isEodMarker(t: PortfolioTrade): boolean {
  const r = t.reason
  return r === 'eod' || r === 'eod_pyr' || r === 'eod_pyr50' || r === 'scalp_eod'
}

/**
 * Canonical per-trade notional for the publicly-displayed equity simulation:
 * a fixed $10,000 starting account × the tier sizing multiplier (0.5 / 0.75 /
 * 1.0). Used to normalize any trade whose notional has been corrupted by the
 * daemon's compound-equity accounting — see normalizeTrade() below.
 */
const TIER_BASE_NOTIONAL: Record<Tier, number> = {
  conservative: 5000,
  moderate:     7500,
  aggressive:   10000,
}

/**
 * Some closed-trade rows arrive with `notional` set to the strategy's
 * compounded internal equity (e.g. SOL = $107,435, LINK = $418,615 instead
 * of the $5k per-trade base). When this happens the published `pnl` is also
 * computed against that bogus notional, so summing pnls into the equity
 * curve or monthly returns produces wildly distorted numbers — the bug
 * you'd see on the Backtesting page where a single stop loss reads as
 * −$17,000 on a $5k position. This normalizer detects any trade whose
 * notional is more than 5× the canonical per-tier base, snaps it back to
 * the base, and recomputes pnl from the (correct) returnPct. The eod
 * markers (currently-open positions) are left alone here — they get a
 * separate display-time override in BacktestingPage's TradesTable.
 */
function normalizeTrade(t: PortfolioTrade, tier: Tier): PortfolioTrade {
  if (isEodMarker(t)) return t
  const base = TIER_BASE_NOTIONAL[tier]
  const n = t.notional || 0
  if (n <= base * 5) return t
  // Snap to base. Returns the same shape so downstream type-narrowing
  // (PortfolioTrade) keeps holding.
  return { ...t, notional: base, pnl: base * (t.returnPct || 0) / 100 }
}

/**
 * Fetch the strategy's portfolio trades for a tier.
 *
 *   includeOpen = false (default)  → closed trades only. Safe for every
 *                                    metric computation: returns, sharpe,
 *                                    drawdown, win rate, monthly returns.
 *   includeOpen = true             → raw set including eod markers. Used by
 *                                    the Backtesting List of Trades so users
 *                                    can see what's currently open and
 *                                    compare with their own Bitget positions.
 */
export async function fetchPortfolioTrades(
  tier: Tier,
  opts: { includeOpen?: boolean } = {},
): Promise<PortfolioTrade[]> {
  const cached = cache.get(tier)
  let raw: PortfolioTrade[]
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    raw = cached.raw
  } else {
    const res = await fetch(pathForTier(tier), { cache: 'no-store' })
    if (!res.ok) throw new Error(`portfolio-trades fetch failed: ${res.status}`)
    const fetched: PortfolioTrade[] = await res.json()
    // Normalize notional/pnl for closed trades that arrived with the
    // daemon's compound-equity values. Eod markers are kept as-is here so
    // the open-positions UI can detect them; the table view in
    // BacktestingPage applies the same canonical-notional override on
    // top of them at render time.
    raw = fetched.map(t => normalizeTrade(t, tier))
    cache.set(tier, { fetchedAt: Date.now(), raw })
  }
  return opts.includeOpen ? raw : raw.filter(t => !isEodMarker(t))
}

/**
 * Admin variant: fetches the full trade list (with cfg_sid, raw
 * displayReason) from /api/admin/portfolio-trades. Requires a Bearer token
 * for the caller's Supabase session. The endpoint enforces requireAdmin()
 * server-side — a non-admin Bearer is rejected with 403.
 *
 * Caller is responsible for omitting strategy IP from the rendered DOM if
 * isAdmin flips false mid-session.
 *
 * Fix #3 (2026-05-23): module-scope 60s cache, mirrors the public path
 * above. Without this every tier switch on an admin session re-hit the
 * gated endpoint (which has no server-side cache, two Supabase round-
 * trips per call, and re-reads the file from disk). Same TTL as public —
 * the daemon publishes both feeds together at bar-close cadence.
 */
const adminCache = new Map<Tier, CacheEntry>()

export async function fetchAdminPortfolioTrades(
  tier: Tier,
  token: string,
  opts: { includeOpen?: boolean } = {},
): Promise<PortfolioTrade[]> {
  const cached = adminCache.get(tier)
  let normalized: PortfolioTrade[]
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    normalized = cached.raw
  } else {
    const res = await fetch(`/api/admin/portfolio-trades?tier=${tier}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`admin portfolio-trades fetch failed: ${res.status}`)
    const j = await res.json() as { trades: PortfolioTrade[] }
    normalized = j.trades.map(t => normalizeTrade(t, tier))
    adminCache.set(tier, { fetchedAt: Date.now(), raw: normalized })
  }
  return opts.includeOpen ? normalized : normalized.filter(t => !isEodMarker(t))
}

export type PortfolioLoad =
  | { status: 'loading' }
  | { status: 'ready'; trades: PortfolioTrade[] }
  | { status: 'error'; message: string }

export function usePortfolioTrades(tier: Tier): PortfolioLoad {
  const [state, setState] = useState<PortfolioLoad>(() => {
    const c = cache.get(tier)
    if (c) return { status: 'ready', trades: c.raw.filter(t => !isEodMarker(t)) }
    return { status: 'loading' }
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const trades = await fetchPortfolioTrades(tier)
        if (!cancelled) setState({ status: 'ready', trades })
      } catch (e: any) {
        if (!cancelled) setState({ status: 'error', message: e?.message || 'Failed to load' })
      }
    }
    load()
    const id = window.setInterval(load, 90_000) // refresh every 90s (daemon publishes every 60s)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [tier])

  return state
}
