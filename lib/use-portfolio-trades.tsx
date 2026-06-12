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
  // 2026-05-27 Option D: the tier this trade belongs to. Shadow daemon runs
  // ONE tier (currently 'moderate'); publisher emits per-tier files. The
  // Backtest page tier picker switches between simulated views — without
  // this tag, the merge layer would leak shadow's moderate trades into the
  // conservative + aggressive views. Trades older than the 2026-05-27
  // schema bump lack this field; the merge layer treats unknown tier as
  // "drop from filtered views" so cross-tier bleed is impossible during
  // the transition window.
  tier?: 'conservative' | 'moderate' | 'aggressive'
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
  // 2026-06-12: repointed phase-h → phase-h-risk so the dashboard/simulator/list serve
  // the SAME canonical risk-sized limit-entry (0.15%/120, 2/4/6) dataset the Backtesting
  // page + bot settings use — FINAL VERSION everywhere, one source. Base = $10k (matches
  // risk_sizing INITIAL + the simulator's strategyBase).
  if (tier === 'conservative') return '/data/strategies/phase-h-risk/portfolio-trades.json'
  return `/data/strategies/phase-h-risk/tiers/${tier}/portfolio-trades.json`
}

// Tiny in-memory cache shared across hooks. Cached across the SESSION so
// tier switches (Conservative ↔ Moderate ↔ Aggressive) are instant after
// the first visit. Publisher runs hourly, so 10-min TTL is safely fresher
// than the underlying data anyway.
//
// 2026-05-26: bumped from 60s → 600s after Chris asked twice for "instant
// tier switching" — the 60s TTL was forcing a full ~900KB re-download on
// every tier change. Plus we now prewarm all 3 tiers on first mount (see
// usePortfolioTrades), so the second + third switch are guaranteed cache
// hits.
type CacheEntry = { fetchedAt: number; raw: PortfolioTrade[] }
const cache = new Map<Tier, CacheEntry>()
const CACHE_MS = 600_000  // 10 min

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
 * Pre-warm the cache for all 3 tiers in parallel. Call once on Backtesting
 * page mount so subsequent tier switches are guaranteed cache hits — no
 * network round-trip, no skeleton flash.
 *
 * Fire-and-forget: errors are swallowed (the live load() will retry the
 * single tier the user actually picked). Returns immediately so callers
 * don't await.
 */
export function prewarmAllTiers(): void {
  const tiers: Tier[] = ['conservative', 'moderate', 'aggressive']
  for (const t of tiers) {
    const cached = cache.get(t)
    if (cached && Date.now() - cached.fetchedAt < CACHE_MS) continue
    // Background fetch; ignore promise rejection.
    void fetchPortfolioTrades(t).catch(() => {/* swallowed — live path will retry */})
  }
}

/** Inspect cache state — true if the tier's trade list is already in memory and fresh. */
export function isTierCached(tier: Tier): boolean {
  const cached = cache.get(tier)
  return !!cached && (Date.now() - cached.fetchedAt < CACHE_MS)
}

// ───────────────────────────────────────────────────────────────────────────
// TWO-STORE consumer (2026-06-04). The customer Backtest page reads from two
// physically separate stores instead of one churning file:
//
//   • CLOSED history  → closed-trades.json  — an APPEND-ONLY, write-once
//     immutable store the publisher maintains (first-published value of each
//     trade is frozen forever). Fetched ~once; never re-derived. This is what
//     kills the flicker: the publisher's hourly full-replay used to rewrite
//     portfolio-trades.json end-to-end, so every poll re-downloaded subtly
//     different historical numbers (trade count 3102→3113, tiny pnl deltas) →
//     the headline metrics + closed rows twitched. The immutable store can
//     only GROW (new closes append); existing rows are byte-identical across
//     refreshes, so metrics derived from it are permanently spot-on.
//
//   • OPEN positions  → portfolio-trades.json (forward store) — the live open
//     book, which legitimately churns (NEAR enters, OP trails, TRX exits).
//     This is the ONLY polling layer.
//
// Shadow bridges the sub-hour gap between publisher runs (merged in the page).
const LIVEREF_BASE = '/data/strategies/phase-h-liveref'

/** Open-position row: eod mark-to-market placeholders + explicit 'open'. */
export function isOpenRow(t: PortfolioTrade): boolean {
  return isEodMarker(t) || t.reason === 'open'
}

function closedPathForTier(tier: Tier, base: string): string {
  if (tier === 'conservative') return `${base}/closed-trades.json`
  return `${base}/tiers/${tier}/closed-trades.json`
}
function forwardPathForTier(tier: Tier, base: string): string {
  if (tier === 'conservative') return `${base}/portfolio-trades.json`
  return `${base}/tiers/${tier}/portfolio-trades.json`
}

// Closed-store cache keyed by `${tier}|${base}`. 10-min TTL mirrors the public
// trade cache — but because the store is immutable, a stale read is never
// WRONG (at most it lacks the last <10min of appends, which the shadow feed
// surfaces anyway). The page additionally ref-caches per tier so the 60s poll
// never re-fetches it (true fetch-once semantics → metrics can't twitch).
const closedCache = new Map<string, { fetchedAt: number; raw: PortfolioTrade[] }>()

/**
 * Fetch the IMMUTABLE closed-trade history for a tier from the append-only
 * store. Returns closed trades only (the store excludes open markers by
 * construction). Normalized identically to fetchPortfolioTrades so derived
 * metrics match. Throws on fetch failure — caller falls back to the forward
 * store's closed subset so the page never goes blank if the file is absent.
 */
export async function fetchClosedTrades(tier: Tier, base: string = LIVEREF_BASE): Promise<PortfolioTrade[]> {
  const key = `${tier}|${base}`
  const cached = closedCache.get(key)
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached.raw
  const res = await fetch(closedPathForTier(tier, base), { cache: 'no-store' })
  if (!res.ok) throw new Error(`closed-trades fetch failed: ${res.status}`)
  const fetched: PortfolioTrade[] = await res.json()
  const raw = fetched.map(t => normalizeTrade(t, tier))
  closedCache.set(key, { fetchedAt: Date.now(), raw })
  return raw
}

// Forward-store opens cache — short TTL so the 60s poll always reflects the
// live open book. Closed rows in the forward file are intentionally ignored
// here (the immutable store owns closed history).
const forwardOpensCache = new Map<string, { fetchedAt: number; raw: PortfolioTrade[] }>()
const FORWARD_OPENS_CACHE_MS = 30_000

/**
 * Fetch ONLY the open positions from the forward portfolio-trades.json store.
 * The closed history is served separately by fetchClosedTrades (immutable).
 * Short-cached so it stays current on each poll.
 */
export async function fetchForwardOpens(tier: Tier, base: string = LIVEREF_BASE): Promise<PortfolioTrade[]> {
  const key = `${tier}|${base}`
  const cached = forwardOpensCache.get(key)
  let raw: PortfolioTrade[]
  if (cached && Date.now() - cached.fetchedAt < FORWARD_OPENS_CACHE_MS) {
    raw = cached.raw
  } else {
    const res = await fetch(forwardPathForTier(tier, base), { cache: 'no-store' })
    if (!res.ok) throw new Error(`forward-trades fetch failed: ${res.status}`)
    const fetched: PortfolioTrade[] = await res.json()
    raw = fetched.map(t => normalizeTrade(t, tier))
    forwardOpensCache.set(key, { fetchedAt: Date.now(), raw })
  }
  return raw.filter(isOpenRow)
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

/**
 * Real-time shadow simulation ledger. Reads the shadow daemon's trades.jsonl
 * via /api/strategies/phase-h/shadow-trades — the same simulated trades that
 * the publisher will eventually replay into portfolio-trades.json, but
 * surfaced at sub-minute cadence so the Backtest page never trails the
 * shadow engine by more than the poll interval.
 *
 * ARCHITECTURE (locked 2026-05-24):
 *   Backtest page = clean shadow simulation.
 *   Live Trading page = Bitget reality.
 *   Pages never mix sources — shadow is read here, NEVER on Live Trading.
 *
 * Returned schema matches PortfolioTrade exactly; `type: 'shadow'` marks
 * shadow-sourced rows. Caller merges with the publisher historical baseline
 * (which dominates the historical span it has covered).
 *
 * 30s module-scope cache mirrors the endpoint's Cache-Control.
 */
type ShadowFeed = { trades: PortfolioTrade[]; lastEventTs: number; fetchedAt: number }
let shadowCache: ShadowFeed | null = null
const SHADOW_CACHE_MS = 30_000

export async function fetchShadowTrades(): Promise<PortfolioTrade[]> {
  const feed = await fetchShadowFeed()
  return feed.trades
}

/**
 * Same as fetchShadowTrades but exposes the lastEventTs (timestamp of the
 * most recent shadow event regardless of whether it pairs into a complete
 * trade). Open positions don't appear in `trades` but still update
 * lastEventTs — use this for freshness signaling.
 *
 * 2026-05-25: added so the Backtest badge can reflect actual shadow
 * activity (not just close-paired trades). Open shadow positions are
 * evidence the daemon is alive even when there's no closed trade yet.
 */
export async function fetchShadowFeed(): Promise<{ trades: PortfolioTrade[]; lastEventTs: number }> {
  if (shadowCache && Date.now() - shadowCache.fetchedAt < SHADOW_CACHE_MS) {
    return { trades: shadowCache.trades, lastEventTs: shadowCache.lastEventTs }
  }
  try {
    const res = await fetch('/api/strategies/phase-h/shadow-trades', { cache: 'no-store' })
    if (!res.ok) return { trades: [], lastEventTs: 0 }
    const j = await res.json() as { trades: PortfolioTrade[]; lastEventTs?: number }
    const trades = j.trades || []
    const lastEventTs = Number(j.lastEventTs || 0)
    shadowCache = { trades, lastEventTs, fetchedAt: Date.now() }
    return { trades, lastEventTs }
  } catch {
    return { trades: [], lastEventTs: 0 }
  }
}

/**
 * Merge publisher historical baseline + shadow recent trades.
 *
 * 2026-05-24 (Issue A fix): the old "shadow.exitTs > max(publisher.exitTs)"
 * filter dropped legitimate shadow trades whenever the publisher had a
 * later same-day replay trade. Concrete incident: shadow fired HYPE on the
 * 2026-05-24 00:00 UTC bar (entry 02:00 UTC); publisher's later historical
 * replay produced a different HYPE trade on the same day at 08:00 UTC for
 * the same cfg. The old merge silently dropped shadow's 02:00 trade — the
 * Backtest page showed 08:00 (= 9am UTC+1 local), customer assumed
 * timestamp bug, real cause was scope-of-replay divergence.
 *
 * New rule: per (cfg_sid, day) dedupe. Shadow wins for any (cfg, day) it
 * has trades for; publisher wins everywhere else. Falls back to
 * (symbol, day) dedupe when cfg_sid is missing (public path strips it).
 *
 * Why per-(cfg, day): publisher does a full historical replay from cold;
 * shadow runs in real-time and carries state (e.g. lane already occupied
 * → next signal CAP_REJECTED). They can legitimately produce different
 * trades for the same cfg on the same day. Shadow is the source of truth
 * for what actually happened; publisher's value is filling in cfgs that
 * shadow hasn't run yet (older history, or cfgs that didn't fire in
 * real-time but would have under a fresh replay).
 */
function tradeKey(t: PortfolioTrade): string {
  // 2026-05-24 Issue A v2 fix: ALWAYS key by (symbol, dir, day) regardless of
  // cfg_sid presence. The publisher's PUBLIC path strips cfg_sid for IP
  // protection, so shadow trades (which always have cfg_sid) and public
  // publisher trades would generate DIFFERENT keys for the same logical
  // trade — defeating the dedupe and leaving publisher's stale version on
  // the page. Trade-off: this is coarser (two distinct cfgs firing on the
  // same symbol+dir+day in publisher would collapse to one when shadow has
  // ANY trade for that key). In practice shadow has very few trades so
  // this only affects the days shadow has covered; the rest of history
  // dedupes precisely because publisher's other days don't collide.
  const day = Math.floor((t.entryTs || 0) / 86_400_000)
  return `${t.symbol}|${t.dir}|${day}`
}

export function mergePublisherAndShadow(
  publisher: PortfolioTrade[],
  shadow: PortfolioTrade[],
  viewedTier?: Tier,
): PortfolioTrade[] {
  // 2026-05-27 Option D: tier-aware merge with split open/closed handling.
  //
  // Step 1 — tier filter.
  // Shadow daemon runs ONE tier (currently 'moderate'). Publisher emits
  // per-tier files (we get the right one via pathForTier). Pre-fix bug:
  // shadow's moderate-tier trades were unioned into every tier view,
  // leaking moderate-only opens (e.g. ADA SHORT on lane 2) into the
  // conservative + aggressive simulated views and overflowing the lane
  // caps the user expected. Filter shadow rows by tier match first.
  // Shadow rows older than the 2026-05-27 schema bump have undefined
  // `tier` and get dropped from filtered views — safer than leaking.
  const shadowFiltered = viewedTier
    ? shadow.filter(t => t.tier === viewedTier)
    : shadow
  if (publisher.length === 0) return shadowFiltered
  if (shadowFiltered.length === 0) return publisher
  // Step 2 — split open vs closed. Open and closed trades have different
  // truth sources:
  //   • OPEN positions: shadow is real-time, publisher's are stale-replay.
  //     If shadow has any opens for this tier, replace ALL publisher opens
  //     with shadow's opens. (Pre-fix bug: both views' opens got UNIONed,
  //     which could exceed tier.n_lanes — e.g. publisher's moderate replay
  //     held SOL+AVAX+TRX but shadow's real-time state held TRX+ADA;
  //     union = 4, which busts moderate's 3-lane cap.)
  //   • CLOSED trades: publisher dominates the historical span; shadow
  //     fills the gap since publisher's last hourly run. Dedup by
  //     (symbol, dir, day) — shadow wins where it has same-day coverage.
  const isOpen = (t: PortfolioTrade): boolean =>
    t.reason === 'eod' || t.reason === 'eod_pyr' || t.reason === 'eod_pyr50' ||
    t.reason === 'scalp_eod' || t.reason === 'open'
  const pubOpens = publisher.filter(isOpen)
  const pubClosed = publisher.filter(t => !isOpen(t))
  const shdOpens = shadowFiltered.filter(isOpen)
  const shdClosed = shadowFiltered.filter(t => !isOpen(t))
  // Opens: UNION BY ASSET (2026-06-03 hardening). Replaces the old
  // wholesale-replace `shdOpens.length > 0 ? shdOpens : pubOpens`, which HID
  // every backtest open whenever the shadow held ANY open — safe only while the
  // shadow's open book equalled the backtest's, and a live trap the moment the
  // shadow diverged (the 2026-06-02 disable bug). Rules:
  //   1. Publisher (backtest) is the open-book truth and is NEVER hidden — every
  //      publisher open survives (as itself, or as the shadow's fresher row for
  //      the same asset).
  //   2. For an asset BOTH hold → use the shadow's row (fresher: it processes
  //      intra-hour exits / trail updates before the next publisher run).
  //   3. A shadow-ONLY asset (one the backtest doesn't currently hold) is ADDED
  //      as bridge data, newest-first, but ONLY while under the tier lane cap —
  //      so the union can never exceed n_lanes or double-count an asset. This is
  //      the lane-cap invariant the original wholesale-replace was protecting,
  //      now preserved WITHOUT hiding any backtest open.
  const TIER_LANES: Record<string, number> = { conservative: 2, moderate: 3, aggressive: 5 }
  const laneCap = viewedTier ? (TIER_LANES[viewedTier] ?? Infinity) : Infinity
  const shdOpenBySymbol = new Map<string, PortfolioTrade>()
  for (const t of shdOpens) shdOpenBySymbol.set(t.symbol, t)
  // Start from publisher opens; swap in the shadow's row where it covers the same
  // asset (single-lane-per-asset → at most one open per symbol on each side).
  const opens: PortfolioTrade[] = pubOpens.map(t => shdOpenBySymbol.get(t.symbol) ?? t)
  const pubOpenSymbols = new Set(pubOpens.map(t => t.symbol))
  const shadowOnlyOpens = shdOpens
    .filter(t => !pubOpenSymbols.has(t.symbol))
    .sort((a, b) => (b.entryTs || 0) - (a.entryTs || 0))
  for (const t of shadowOnlyOpens) {
    if (opens.length >= laneCap) break
    opens.push(t)
  }
  // Closed: dedup by tradeKey — shadow wins for any (cfg|symbol, day) it covers
  const shadowClosedKeys = new Set<string>()
  for (const t of shdClosed) shadowClosedKeys.add(tradeKey(t))
  const survivorsClosed = pubClosed.filter(t => !shadowClosedKeys.has(tradeKey(t)))
  return [...survivorsClosed, ...shdClosed, ...opens]
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
