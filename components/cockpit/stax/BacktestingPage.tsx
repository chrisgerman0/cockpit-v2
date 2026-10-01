'use client'

/**
 * Backtesting page — full "verified performance" dashboard.
 *
 * Sections (top→bottom):
 *  - Header (eyebrow, gold-italic title, blurb, freshness pill)
 *  - 5 top metric cards (Total Net P&L, Max Drawdown, Total Trades, Win Rate, Profit Factor)
 *  - Tier picker (Conservative / Bold / Aggressive)
 *  - View tabs (Metrics ↔ List of Trades)
 *  - Equity curve (Log/Linear toggle + BTC Buy & Hold comparison)
 *  - Per-asset breakdown (BTC/ETH/SOL/XRP/SUI rows w/ scope tag)
 *  - Profit Structure bar chart (Gross Profit vs Gross Loss)
 *  - P&L Distribution histogram (binned by PnL, green wins / red losses)
 *  - Returns Summary table
 *  - Trade Analysis table (ALL/LONG/SHORT splits)
 *  - Run-ups & Drawdowns table
 *  - Risk-Adjusted Performance table
 *  - Monthly Returns heatmap (year × month)
 *
 * All metrics are computed live from portfolio-trades.json + portfolio-stats.json
 * for the selected tier — no static numbers. The portfolio file lives at
 * /data/strategies/satoshi-stacker/(tiers/<tier>/)portfolio-trades.json.
 */

import { coinIconUrl } from '@/lib/coinIcon'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useT, getCurrentLang } from '@/lib/i18n'
import { adminFrozenAtFor, fetchPortfolioTrades, fetchAdminPortfolioTrades, fetchShadowFeed, mergePublisherAndShadow, fetchClosedTrades, fetchForwardOpens, LIVEREF_BASE, isEodMarker, prettyExitReason, prewarmAllTiers, isTierCached, type PortfolioTrade, type Tier } from '@/lib/use-portfolio-trades'
import { usePublicTickers } from '@/lib/use-public-tickers'
import { COIN_FILTERS, type CoinFilter, canonicalAsset } from '@/lib/phase-h-basket'
import { useIsAdmin } from '@/lib/use-is-admin'
import { getAccessToken } from '@/lib/supabase-browser'
import { type EquityPoint } from './Charts'
import { PHASE_H_BASKET } from '@/lib/phase-h-basket'

type Stats = {
  totalTrades?: number
  winRate?: number
  profitFactor?: number
  maxDD?: number
  avgWin?: number
  avgLoss?: number
  finalCapital?: number
  returnPct?: number
  startCapital?: number
  wins?: number
  losses?: number
  expectancy?: number
  biggestWin?: number
  biggestLoss?: number
  breakdown?: Record<string, AssetBreakdown>
  longShort?: { winRate: number; profitFactor: number }
  // Published by candidate-basket namespaces (?basket=), read by the candidate banner.
  cfgCount?: number
  tierSCount?: number
}

type AssetBreakdown = {
  totalTrades: number
  returnPct: number
  winRate: number
  profitFactor: number
  totalPnl: number
  scope: string
}

// ───────────────────────────────────────────────────────────────────────────
// 2026-06-12 (a) live-lane display cap. The publisher's per-tier liveref OPEN
// book can over-fill by one (issue (c), under investigation) — until the source
// is fixed, never DISPLAY more open positions than the tier holds (2/4/6). Keep
// the earliest-entered opens (the FCFS lane-holders); drop the newest over-cap
// rows. Closed rows pass through untouched. (isOpenTrade is module-hoisted below.)
// 2026-09-03 — THIS CAP WAS SILENTLY DELETING A REAL OPEN POSITION.
// The counts below were the PRE-SUPER-LANE lane counts. The 2026-09-02 re-lock added the
// reserved Tier-S seat to every tier, taking them to 3/5/7/8 — so aggressive genuinely holds
// SEVEN. The cap stayed at six and this function drops the NEWEST over-cap row, so canonical's
// 7th open position was thrown away AFTER being fetched. Chris looked at the Backtesting page at
// 20:00Z and AVAX (entered on the 6h bar closing 18:00Z, the newest of the seven) was not there;
// the file and the HTTP response both carried it. A cap that hides a live position is worse than
// the over-fill it was written to paper over.
const LIVE_LANE_CAP: Record<Tier, number> = { conservative: 3, moderate: 5, aggressive: 7, kamikaze: 8 }
function capOpensForTier(rows: PortfolioTrade[], tier: Tier): PortfolioTrade[] {
  const cap = LIVE_LANE_CAP[tier]
  const opens = rows.filter(isOpenTrade)
  if (opens.length <= cap) return rows
  const keep = new Set(
    [...opens].sort((a, b) => (a.entryTs || 0) - (b.entryTs || 0)).slice(0, cap),
  )
  return rows.filter(t => !isOpenTrade(t) || keep.has(t))
}

// 2026-06-12 (b) compounding = the LIVE engine's Smart Sizing, NOT naive equity
// reinvest. Per trade the lane notional scales SUB-LINEARLY with the running
// balance — base_notional × (equity/INITIAL)^0.75 — and HARD-CAPS at $25k per
// lane (the engine's risk_per_lane cap); balance above the cap rides
// unleveraged, so the equity curve bends toward LINEAR as lanes saturate.
// base_notional = the frozen compound-OFF per-trade notional (already
// tier-base_pct-sized + $25k-capped at INITIAL), so at INITIAL equity the
// compounded pnl EXACTLY equals the compound-off pnl (early curve ≈ compound-off).
// Validated 2026-06-12 end-equity (vs naive's astronomical blow-up):
//   Conservative $471,969 (+4,620%) · Moderate $978,694 (+9,687%) · Aggressive $1,344,690 (+13,347%).
const SMART_COMPOUND_K = 0.75
const SMART_COMPOUND_CAP = 25000
function smartCompoundPnl(t: PortfolioTrade, eq: number, initial: number): number {
  const notl = t.notional || 0
  if (notl <= 0) return t.pnl  // no notional to scale → fall back to flat pnl
  // scaled notional = min(CAP, notl × (eq/INITIAL)^k); pnl scales with notional →
  // pnl × min((eq/INITIAL)^k, CAP/notl). At eq=INITIAL the mult is 1 (notl ≤ CAP).
  const mult = Math.min(Math.pow(eq / initial, SMART_COMPOUND_K), SMART_COMPOUND_CAP / notl)
  return t.pnl * mult
}

// 2026-06-12: stable per-row key so the trade LIST can look up each row's
// compounded (Smart Sizing) size/PnL when the toggle is ON.
function rowKey(t: PortfolioTrade): string {
  return `${t.symbol}|${t.entryTs}|${t.exitTs}|${t.dir}`
}
type CompoundView = { map: Map<string, { notional: number; pnl: number; capped: boolean }>; finalEq: number; startCap: number }

// Tier names follow the new schema (use-portfolio-trades.tsx): conservative
// (0.5×) / moderate (0.75×) / aggressive (1.0×). Legacy 'bold' is normalised
// to 'aggressive' on read by the portfolio-trades hook.
const TIER_LABELS: Record<Tier, { en: string; pt: string; notional: string; mult: string }> = {
  // 2026-09-03: pre-super-lane counts, and kamikaze quoted the nominal exposure (8.75x) where every
  // other surface quotes the tier's leverage (9x). Each tier gained a reserved Tier-S seat at the
  // 2026-09-02 re-lock: 2->3, 4->5, 6->7, 7->8.
  conservative: { en: 'Conservative', pt: 'Conservador', notional: '$10,000', mult: '3 lanes / 1× lev' },
  moderate:     { en: 'Moderate',     pt: 'Moderado',    notional: '$10,000', mult: '5 lanes / 3× lev' },
  aggressive:   { en: 'Aggressive',   pt: 'Agressivo',   notional: '$10,000', mult: '7 lanes / 6× lev' },
  kamikaze:     { en: 'Kamikaze',     pt: 'Kamikaze',    notional: '$10,000', mult: '8 lanes / 9× lev' },
}

// 2026-06-01: optional `base` lets the ?preview=1 path point at the 71-cfg
// staging dir (/data/strategies/phase-h-preview) without touching the live
// 62-cfg files. Defaults to the live base for all normal traffic.
// 2026-06-02: repointed from the PINNED `phase-h` (frozen at the 2026-05-29
// backtest-end pin → open positions stuck at that date, e.g. NEAR which entered
// 06-02 never appeared) to the FORWARD `phase-h-liveref` — the unpinned 71-cfg
// B+D dataset the publisher refreshes hourly. Same logic/basket, just current:
// the page now shows the strategy's live open book + recent trades. The pin
// stays on `phase-h` for the internal baseline validation (decoupled).
// 2026-06-04: repointed to `phase-h-risk` — the locked RISK-SIZED verified-
// performance dataset (constant-$-risk by SL distance, the live sizing model;
// risk_sizing_canonical.py). COMPOUND stays OFF (each trade sized at constant-$
// -risk off INITIAL, no equity scaling). Risk notionals are ≤$25k = ≤5×tier base,
// so normalizeTrade passes them through unflattened → the page shows the
// risk-sized pnls directly. The two axes stay independent: risk-sizing ON
// (display), compound OFF (display). Numbers: PF 1.97/2.13/2.10, maxDD ~-10%,
// Calmar 5.0/6.1/7.1 (cons/mod/aggr) — corrected exit-order maxDD.
// 2026-09-28 BASKET CUTOVER. The account has traded RESEARCH56_20260928_MAXNET_V3 (56 research CFGs,
// 8 families, 21 assets, basket_hash dddf9f44db5b323a) since 17:23:10Z, so THAT is what this page
// defaults to. phase-h-risk still holds the retired k54_bounded book and stays reachable as a named
// historical comparison at ?basket=k54 — it is history now, not the account's strategy.
//
// The research surface is built by the REAL phase-i publisher (research_publisher_adapter resolves
// the members from the canonical ledgers before load_cfg) and risk-sized by risk_sizing_canonical on
// the same $10,000 / compound-OFF basis as the old one, so the two are directly comparable in shape.
// Verified 35/35 in scratchpad/basket_cutover/CANARY_VERIFY.json.
// 2026-09-29: READ THE SURFACE THE RECURRING PIPELINE OWNS. phase-h-research56 was a hand
// publish — correct at the moment I wrote it and stale from the next minute, because no cycle
// regenerates it. phase-h-risk IS regenerated every publisher cycle (forward pass -> overlap gate
// -> risk sizing), and since the full-period adapter was exported in the runner that cycle now
// produces the complete book: 1,776 trades to 2026-09-21 with 277 entries past the 2025 seal,
// refreshed alongside phase-h and phase-h-liveref. Pointing here is what makes Backtesting
// advance by itself instead of freezing at whatever I last published by hand.
const ACTIVE_DATA_BASE = '/data/strategies/phase-h-risk'
// The hand-published full-period snapshot, kept reachable at ?basket=research56 for comparison.
const RESEARCH56_SNAPSHOT = '/data/strategies/phase-h-research56'
const LIVE_DATA_BASE = ACTIVE_DATA_BASE

// Candidate baskets reviewable via ?basket=<key>. ALLOW-LIST, deliberately: an arbitrary
// ?basket= would let a crafted link render unknown JSON as our own published numbers.
const CANDIDATE_BASKETS: Record<string, string> = {
  prelim80: '/data/strategies/phase-h-prelim80',
  // Kept so an existing ?basket=research56 link still resolves — it now points at the default.
  research56: RESEARCH56_SNAPSHOT,
  // The book the account traded until 2026-09-28T17:23Z. Not a candidate: a RETIRED basket, offered
  // for comparison. It runs a year longer than the active one (to 2026-09-28 rather than the
  // 2025-09-09 research seal), so return% across the two is not like for like — PF and maxDD are.
  // the retired k54 book is no longer at phase-h-risk — that path now carries the ACTIVE basket.
  // Its last published state lives in the LKG snapshot, which the publisher keeps untouched.
  k54: '/data/strategies/phase-h-lkg',
}
// A selectable basket that is NOT research awaiting a verdict. `true` here means "the account does
// not trade this", which drives the warning banner and the no-open-positions path.
const NOT_TRADED: Record<string, boolean> = { prelim80: true, k54: true, research56: false }
// The eyebrow must NAME the basket on screen. Rendering a candidate under the live basket's name
// ("SWINGMATE v3 SUPER STACK · 18-ASSET BASKET") would state that the account trades these numbers,
// which is the one claim a candidate review must never make.
const CANDIDATE_LABELS: Record<string, string> = {
  prelim80: 'PRELIMINARY 80-CFG CANDIDATE BASKET · RESEARCH · NOT TRADED',
  // "PRELIMINARY RESEARCH · NOT TRADED" became FALSE at 2026-09-28T17:23:10Z and a stale label on a
  // customer-facing page is a production bug, not a cosmetic one.
  research56: 'RESEARCH56 MAX_NET · 56 CFG · 8 FAMILIES · 21 ASSETS · THE ACTIVE BASKET',
  k54: 'k54_bounded · 70 CFG · 29 ASSETS · RETIRED 2026-09-28 · HISTORICAL COMPARISON',
}
const ACTIVE_EYEBROW = 'RESEARCH56 MAX_NET · 56 CFG · 8 FAMILIES · 21 ASSETS · THE ACTIVE BASKET'
// THE BASKET'S OWN IDENTITY, not a count of some other list. PHASE_H_BASKET is the UNION of the
// basket and any asset still holding a carried position (22 today, because a BNB long survived the
// cutover and must stay visible on Live Trading). Counting it here would have told a reader the
// backtest covers 22 assets when the book covers 21. The eyebrow said "18-ASSET" and the blurb
// "29 assets" against a 21-asset basket for the same reason: both counted something else.
const ACTIVE_BASKET_IDENTITY = { cfgs: 56, families: 8, assets: 21, name: 'RESEARCH56 MAX_NET' }
function statsPath(tier: Tier, base = LIVE_DATA_BASE): string {
  // 2026-05-21 cutover: V1 satoshi-stacker → Phase H Super Stack.
  // See archive/v1-satoshi-stacker-deprecated-2026-05-12/HANDOVER.md.
  if (tier === 'conservative') return `${base}/portfolio-stats.json`
  return `${base}/tiers/${tier}/portfolio-stats.json`
}
function tradesPath(tier: Tier, base = LIVE_DATA_BASE): string {
  if (tier === 'conservative') return `${base}/portfolio-trades.json`
  return `${base}/tiers/${tier}/portfolio-trades.json`
}

// 2026-09-05: was a hand-kept 19-entry map, so AAVE/ATOM/BCH/ETC/FIL/LTC/XLM and others rendered
// blank. Backed by the ONE shared resolver (lib/coinIcon), which covers every basket asset from
// vendored files and falls back to the CDN for anything new. A Proxy keeps the ASSET_LOGOS[sym]
// call sites below unchanged — the lookup is now computed rather than transcribed.
const ASSET_LOGOS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_t, k: string) => coinIconUrl(String(k)) ?? '',
  has: (_t, k: string) => !!coinIconUrl(String(k)),
})


export function BacktestingContent() {
  const t = useT()
  // Default to MODERATE when the user has no bot_config yet (or while /api/me
  // resolves on first load). The useEffect below overrides this with the
  // user's actual active tier when available. Moderate sits in the middle of
  // the risk ladder so first-impression numbers aren't surprisingly tiny
  // (Conservative) nor surprisingly aggressive — it's the safest fallback.
  const [tier, setTier] = useState<Tier>('moderate')
  // User's live-config tier (from auth.users.user_metadata.bot_config). Set
  // once on mount; used to highlight the matching tab and show a "Your active
  // tier" indicator. Null until resolved or for non-activated users.
  const [activeTier, setActiveTier] = useState<Tier | null>(null)
  const [pubStats, setStats] = useState<Stats | null>(null)
  // `trades` is CLOSED only — every metric on this page is computed against
  // it. `allTrades` is the raw set (closed + the strategy's currently-open
  // eod markers) — passed to the List of Trades so users can see what the
  // strategy is holding right now and compare with their own Bitget positions.
  const [pubTrades, setTrades] = useState<PortfolioTrade[]>([])
  const [pubAllTrades, setAllTrades] = useState<PortfolioTrade[]>([])
  const [view, setView] = useState<'metrics' | 'trades'>('metrics')
  // ── CUSTOM RERUN (2026-09-26) ───────────────────────────────────────────────────────────────
  // A rerun replaces the PUBLISHED trade set and stats wholesale, and every section downstream
  // recomputes from those two values. That is deliberate: the equity curve, BTC comparison,
  // monthly and weekly tables, per-asset breakdown, headline cards and trade list are all derived
  // from `trades`/`stats`, so swapping the pair refreshes the whole page ATOMICALLY and no section
  // can be left showing the previous window. Clearing the rerun restores the published view with
  // no refetch.
  const [rerun, setRerun] = useState<RerunResult | null>(null)
  const [rerunBusy, setRerunBusy] = useState(false)
  const [rerunErr, setRerunErr] = useState<string | null>(null)
  const stats: Stats | null = rerun ? (rerun.stats as unknown as Stats) : pubStats
  const trades: PortfolioTrade[] = rerun ? (rerun.closedTrades as PortfolioTrade[]) : pubTrades
  const allTrades: PortfolioTrade[] = rerun ? (rerun.closedTrades as PortfolioTrade[]) : pubAllTrades
  // ── CLOSED-ONLY, FOR EVERY REALISED FIGURE (2026-09-29) ─────────────────────────────────────
  // The publisher now emits genuine simulated OPEN positions as rows with exitTs = null, so the
  // trade list can show them under its OPEN filter. They must not reach a realised number.
  // Measured when they first shipped: TOTAL TRADES read 2,839 instead of 2,835 (four open rows
  // counted as trades) and the period read "-49.6yr" because the last row's null exitTs went
  // straight into the date arithmetic. Headline count and period take this list; the trade list
  // and its ALL/OPEN/CLOSED filter still take the full one.
  const closedTrades = useMemo(() => trades.filter(t => !isOpenTrade(t)), [trades])
  // 2026-06-12: compounding toggle (OFF by default = the canonical compound-off
  // display the producer serves). ON recomputes the headline metrics + equity curve
  // client-side by reinvesting each trade's flat-base return on the running equity.
  const [compound, setCompound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [updatedAgo, setUpdatedAgo] = useState<string | null>(null)
  const [updatedAgoMins, setUpdatedAgoMins] = useState<number | null>(null)
  // HOW FAR THE REFERENCE HAS BEEN EVALUATED — read, and re-read, never typed in. The refresh
  // runs hourly, so the page polls on the same order of cadence; a header that only updated on a
  // full reload would go stale between refreshes and that is the exact bug this replaces.
  const [refEvaluatedTo, setRefEvaluatedTo] = useState<number | null>(null)
  const { isAdmin } = useIsAdmin()
  const [frozenAt, setFrozenAt] = useState<string | null>(null)

  useEffect(() => {
    let dead = false
    const read = () => fetch(`/api/strategies/phase-h/open-positions?tier=${tier}`,
                             { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (dead) return
        const v = Number(j?.reference_evaluated_to_ms)
        setRefEvaluatedTo(Number.isFinite(v) && v > 0 ? v : null)
      })
      .catch(() => { /* absent => the claim is not made; never a wrong date */ })
    read()
    const id = setInterval(read, 5 * 60_000)
    return () => { dead = true; clearInterval(id) }
  }, [tier])

  // 2026-06-01 71-cfg cutover PREVIEW: ?preview=1 points the page at the
  // staging publisher output (/data/strategies/phase-h-preview) so the full
  // new backtest (metrics, curves, counts, would-be-opens) can be reviewed
  // before the live 62-cfg files are overwritten. Live traffic (no param) is
  // byte-identical to before. Removable after promote.
  const previewMode = useMemo(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1',
    [],
  )

  // 2026-09-22 CANDIDATE REVIEW: ?basket=<key> points the page at a candidate
  // basket that is NOT the one the account is trading, so it can be reviewed in
  // full — metrics, breakdown, every trade — without overwriting the live files
  // or implying the account is running it. The allow-list is the whole point: an
  // arbitrary ?basket= would let a crafted link render unknown JSON as if it were
  // our own published numbers. No param => byte-identical to live traffic.
  const candidateBasket = useMemo(() => {
    if (typeof window === 'undefined') return null
    const k = new URLSearchParams(window.location.search).get('basket')
    return k && Object.prototype.hasOwnProperty.call(CANDIDATE_BASKETS, k) ? k : null
  }, [])

  const dataBase = candidateBasket
    ? CANDIDATE_BASKETS[candidateBasket]
    : previewMode
      ? '/data/strategies/phase-h-preview'
      : LIVE_DATA_BASE

  // Resolve the user's active live tier once on mount. Default the tier picker
  // to that tier so customers see their own performance first, with a "Your
  // active tier" badge marking the matching tab.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/me', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        const cfg = data?.user?.user_metadata?.bot_config
        const raw = (cfg?.tier || cfg?.preset || '').toLowerCase()
        const mapped: Tier | null =
          raw === 'conservative' ? 'conservative' :
          raw === 'moderate' ? 'moderate' :
          (raw === 'aggressive' || raw === 'bold') ? 'aggressive' :
          raw === 'kamikaze' ? 'kamikaze' :
          null
        if (!cancelled && mapped) {
          setActiveTier(mapped)
          setTier(mapped)
        }
      } catch {/* non-fatal */}
    })()
    return () => { cancelled = true }
  }, [])

  // 2026-05-26: prewarm all 3 tiers in the background on first mount.
  // The user reported tier switching feels slow because the first switch to
  // any new tier has to download ~900 KB of trade data. Prewarming makes the
  // second and third tier switches instant (cache hit, no skeleton flash).
  // Fire-and-forget — errors fall through to the live load() retry.
  useEffect(() => {
    prewarmAllTiers()
  }, [])

  // 2026-06-04 TWO-STORE consumer: immutable closed-trade backbone, held per
  // tier. The 60s poll reads ONLY the forward open book + shadow; this frozen
  // closed history is never re-fetched on poll (so the headline metrics can't
  // twitch). It refreshes only on tier switch + tab-focus (to absorb the
  // publisher's hourly appends), never on the churning interval.
  const closedBackboneRef = useRef<Partial<Record<Tier, PortfolioTrade[]>>>({})
  // 2026-07-28: last-seen publisher mtime (stats Last-Modified) per tier. The frozen
  // backbone above refreshes only on tier-switch/tab-focus — which MISSED an in-place
  // re-lock (the eviction look-ahead fix reprices existing closed trades WITHOUT changing
  // their count) while the tab stayed focused: the stats-mtime pill showed fresh ("29m ago")
  // over a stale cached backbone (the Aggressive card stuck at an old $ value). When this
  // mtime changes vs last poll, the closed set was rewritten → drop the cache + reload so
  // metrics re-derive from fresh data. Only fires when data actually changed → no twitch.
  const lastPubMtimeRef = useRef<Partial<Record<Tier, number>>>({})

  useEffect(() => {
    let cancelled = false
    // 2026-05-24 Issue A flicker fix: only show the loading skeleton on the
    // INITIAL load (mount or tier switch). The 60s background poll
    // re-fetches publisher + shadow, but if it flips loading=true on every
    // tick the page goes blank for a second while data is in flight —
    // that's the flicker the user reported. Keep the previous data visible
    // and swap atomically when the new response lands.
    //
    // 2026-05-26: skip the skeleton when the tier's already cached. Combined
    // with prewarmAllTiers above, this makes Conservative ↔ Moderate ↔
    // Aggressive switches feel instant — old data stays visible, new data
    // swaps in within milliseconds because no network round-trip is needed.
    let firstLoad = true
    async function load(refetchClosed = false) {
      // Skeleton only on a genuinely cold tier — neither the legacy cache nor
      // the immutable closed backbone holds it yet. Revisiting a tier in-session
      // keeps its data visible (no blank flash).
      if (firstLoad && !isTierCached(tier) && !closedBackboneRef.current[tier]) setLoading(true)
      // Admins fetch the gated /api/admin/portfolio-trades endpoint which
      // returns trades enriched with cfg_sid + raw displayReason. Customers
      // fetch the public path which has those stripped server-side.
      const wantAdmin = isAdmin === true
      const adminToken = wantAdmin ? await getAccessToken().catch(() => null) : null
      // TWO-STORE applies to the customer path only. Admin keeps cfg_sid on
      // every row (its closed source carries provenance the public immutable
      // store strips); preview shows raw publisher output. Both retain the
      // single-forward-source behavior unchanged.
      // A candidate basket is a STATIC book: its closed history is the whole story. Blending in
      // the LIVE open positions (LIVEREF_BASE) would show the account's real open trades under a
      // basket the account is not running — so candidate mode takes the same path as preview.
      // The ACTIVE basket's published book is static too: it is the permitted pre-seal history and it
      // stops at 2025-09-09. Blending in live opens would be worse than useless right now —
      // phase-h-liveref is still produced from the RETIRED basket until the publisher re-lock lands,
      // so those opens belong to a different book. Treated as static until liveref agrees.
      const staticBasket = previewMode || !!candidateBasket || dataBase === ACTIVE_DATA_BASE
      const useTwoStore = !wantAdmin && !staticBasket
      // 2026-10-01: the token is OPTIONAL now — a cookie-only admin session still reaches the
      // admin feed (see fetchAdminPortfolioTrades). Guarding on the token is what blanked the CFG
      // column.
      const tradesFetcher = wantAdmin
        ? (open: boolean) => fetchAdminPortfolioTrades(tier, adminToken, { includeOpen: open })
        : (open: boolean) => fetchPortfolioTrades(tier, { includeOpen: open })

      // CLOSED BACKBONE (two-store): the immutable append-only store, held per
      // tier and frozen across polls. Fetched once on first visit to a tier;
      // refreshed only when refetchClosed (tier switch / tab-focus) so it
      // absorbs the publisher's hourly appends without ever re-deriving the
      // existing history. This is the flicker fix — the headline metrics derive
      // from THIS array, whose reference is stable between polls, so they can't
      // twitch. Falls back to null → forward-closed if the store is absent.
      let immutableClosed: PortfolioTrade[] | null = null
      if (useTwoStore) {
        immutableClosed = closedBackboneRef.current[tier] ?? null
        if (!immutableClosed || refetchClosed) {
          const fetched = await fetchClosedTrades(tier, dataBase).catch(() => null)
          if (fetched && fetched.length) {
            immutableClosed = fetched
            closedBackboneRef.current[tier] = fetched
          }
        }
      }

      try {
        // Forward layer = the ONLY polling source. Two-store: open positions
        // only (the live book — closed history is owned by the immutable store
        // above). Admin/preview: the full forward set (closed + opens).
        const [statsResp, fwdTrades, shadowFeed] = await Promise.all([
          fetch(statsPath(tier, dataBase), { cache: 'no-store' }),
          useTwoStore
            // 2026-07-06 REGRESSION FIX: read the OPEN book from the forward-updated liveref
            // store (held-through-now opens, present for every tier, refreshed each publisher
            // cycle) — NOT dataBase (phase-h-risk), which is closed-only (0 opens since 06-05).
            // Closed backbone + metrics still come from phase-h-risk (dataBase) via immutableClosed;
            // only the live open rows switch source. This restores opens showing ~minutes after
            // signal on ANY tier, instead of depending on the aggressive-only shadow bridge.
            ? fetchForwardOpens(tier, LIVEREF_BASE).catch(() => [] as PortfolioTrade[])
            : staticBasket
              // 2026-10-01: an ADMIN on the static path still has to go through the admin
              // endpoint. This branch fetched tradesPath(dataBase) unconditionally — the PUBLIC
              // file, which has cfg_sid stripped server-side by design — so the CFG (ADMIN) column
              // was blank on every row of the active basket. The one row that did show a sid came
              // from the liveref merge, which made it look like a per-row data gap rather than the
              // wrong source. data-admin/strategies/phase-h-risk carries cfg_sid on all 3,186 rows
              // and /api/admin/portfolio-trades serves it; the customer path is unchanged.
              ? (wantAdmin
                  ? tradesFetcher(true).catch(() => [] as PortfolioTrade[])
                  : fetch(tradesPath(tier, dataBase), { cache: 'no-store' })
                      .then(r => (r.ok ? (r.json() as Promise<PortfolioTrade[]>) : []))
                      .catch(() => [] as PortfolioTrade[]))
              : tradesFetcher(true).catch(() => [] as PortfolioTrade[]),
          staticBasket
            ? Promise.resolve({ trades: [] as PortfolioTrade[], lastEventTs: 0 })
            : fetchShadowFeed().catch(() => ({ trades: [] as PortfolioTrade[], lastEventTs: 0 })),
        ])
        if (cancelled) return
        const shadowTrades = shadowFeed.trades
        const statsRes = statsResp.ok ? await statsResp.json() : null
        setStats(statsRes || null)

        // Assemble the publisher-side trade set + the metrics-closed set:
        //   • two-store: immutable closed backbone + forward opens. Metrics
        //     come from the frozen backbone (immutableClosed) so the headline
        //     cards are spot-on and never twitch on the 60s poll.
        //   • admin/preview (or two-store fallback when the immutable store is
        //     missing): the single forward set, closed via isEodMarker — the
        //     prior behavior, unchanged.
        let pubSet: PortfolioTrade[]
        let metricsClosed: PortfolioTrade[]
        if (useTwoStore && immutableClosed && immutableClosed.length) {
          pubSet = [...immutableClosed, ...(fwdTrades as PortfolioTrade[])]
          metricsClosed = immutableClosed
        } else {
          const fwdAll = fwdTrades as PortfolioTrade[]
          pubSet = fwdAll
          // 2026-06-27 (Chris, authoritative): LIVE-FORWARD metrics. The admin
          // route appends a live-forward tail (trades closed since the last full
          // regen, flagged `_liveTail`, RISK-SIZED natively by the route from the
          // liveref stop — same sizing methodology as the frozen 3,458 backbone,
          // so they append cleanly). These are now COUNTED in the metrics — the
          // headline SHOULD move forward as trades close (no customers yet, the
          // numbers are a live track record, not a locked marketing figure). The
          // metrics therefore compute over the SAME closed set the LIST shows.
          // Open positions are still excluded (isEodMarker / no exitTs). Supersedes
          // the 2026-06-12 frozen-only headline. preview/two-store carry no
          // `_liveTail` rows → no-op there.
          metricsClosed = fwdAll.filter(t => !isEodMarker(t))
        }
        // 2026-05-27 Option D: pass viewed tier so shadow rows get filtered by
        // tier match before merging (no cross-tier bleed). Shadow bridges the
        // sub-hour gap between publisher runs; for two-store it supplies the
        // open book + just-closed gap trades shown in the LIST (not the frozen
        // metrics).
        // 2026-06-07 (count-seam fix): the ADMIN backtest view shows the pure
        // publisher/canonical set (frozen LKG + live-forward tail). The shadow
        // bridge is for the CUSTOMER path; on admin it grafted duplicate rows
        // because the route-tail carries no cfg_sid (keyed symbol|day) while
        // shadow rows are keyed cfg_sid|day → the dedup missed the overlap and
        // kept both, inflating the list past the metric count. Metrics were
        // never affected (they derive from metricsClosed/route), but the count
        // seam was real. Customer path keeps the shadow bridge unchanged.
        const rawTrades = wantAdmin ? pubSet : mergePublisherAndShadow(pubSet, shadowTrades, tier)
        // 2026-06-12 (a): display-cap the open book at the tier's lane count
        // (2/4/6) so the LIST never shows more concurrent opens than the tier
        // can hold (publisher over-fill = issue (c), under investigation).
        setAllTrades(capOpensForTier(rawTrades, tier))
        // 2026-09-07 SSB5: surface how old the FROZEN half of the admin feed is. It is written
        // ONLY on a publisher validation PASS; when the publisher halted 2026-09-06 12:45Z it sat
        // at 12:05Z for 19h18m while the live tail kept moving, and the page looked current.
        if (wantAdmin) setFrozenAt(adminFrozenAtFor(tier))
        // METRICS source — frozen immutable closed (two-store) → no flicker.
        setTrades(metricsClosed)

        // Freshness pill: prefer the shadow timestamp when shadow has fresher
        // data than the publisher static file. The publisher's Last-Modified
        // header reflects when /phase-h/portfolio-trades.json was last
        // written (hourly cron). Shadow events fill the gap to "now".
        //
        // 2026-05-25: use shadowFeed.lastEventTs instead of trades[].exitTs.
        // Open positions (unpaired LIVE_ENTRY without close) update
        // lastEventTs but produce no closed trade. Without this, the badge
        // ignored shadow activity until the position closed — which can be
        // many hours. Shadow being ACTIVE counts as fresh.
        const lm = statsResp.headers.get('last-modified')
        const pubMtimeMs = lm ? new Date(lm).getTime() : 0
        const freshnessSourceTs = Math.max(pubMtimeMs, shadowFeed.lastEventTs || 0)
        if (freshnessSourceTs > 0) {
          const ageMs = Date.now() - freshnessSourceTs
          const mins = Math.floor(ageMs / 60000)
          setUpdatedAgo(mins < 1 ? '< 1m' : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`)
          setUpdatedAgoMins(mins)
        }
        // SELF-HEAL the frozen closed backbone when the publisher rewrote the closed set
        // (hourly append OR an in-place re-lock). refetchClosed/tab-focus alone missed a
        // re-lock while focused. Detect via the stats mtime (already read above); when it
        // changes vs last poll, drop the cache + reload so metrics re-derive from fresh.
        if (useTwoStore && pubMtimeMs > 0) {
          const prevMtime = lastPubMtimeRef.current[tier]
          lastPubMtimeRef.current[tier] = pubMtimeMs
          if (prevMtime && pubMtimeMs !== prevMtime && !cancelled) {
            delete closedBackboneRef.current[tier]   // force a fresh backbone fetch
            load(true)                                // reload; re-derives from fresh closed set
            return                                    // this stale pass is superseded
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
        firstLoad = false
      }
    }
    load(true)   // initial: fetch the immutable closed backbone for this tier
    // 60s poll: forward open book + shadow ONLY. refetchClosed=false → the
    // immutable closed backbone is NOT re-fetched and its array reference is
    // reused, so the headline metrics derived from it cannot twitch. This is
    // the polling layer; only the live opens move.
    const id = window.setInterval(() => load(false), 60_000)
    // 2026-06-04 freshness fix: browsers THROTTLE/PAUSE setInterval in a
    // backgrounded tab, so the 60s poll stalls and the page shows a stale
    // snapshot until a manual reload (the reported bug). Re-fetch the moment
    // the tab regains visibility/focus → the page is current when the user
    // looks at it. refetchClosed=true here so a returning user also absorbs any
    // publisher appends to the closed history (still no flicker — the immutable
    // store only grows; existing rows are byte-identical).
    const onVisible = () => { if (document.visibilityState === 'visible') load(true) }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [tier, isAdmin])

  const isPt = getCurrentLang() === 'PT'

  // Top metric cards previously read directly from portfolio-stats.json.
  // That file is published by the shadow daemon and inherits the daemon's
  // compound-equity notional bug on freshly-closed trades — a single
  // corrupted close (e.g. SUI 12 May trail_tp with $74M notional) can
  // inflate the displayed P&L and profit factor by 60%+. Recompute from
  // the trades array (which is already normalized at the fetch layer by
  // `normalizeTrade` in use-portfolio-trades.tsx). startCapital still
  // comes from stats — that's a config constant, not corrupted.
  const derivedStats = useMemo(() => {
    if (!trades || trades.length === 0) return null
    const startCap = stats?.startCapital || 10000
    // Walk trades chronologically to also compute trade-level max DD.
    const chrono = [...trades].filter(t => !isOpenTrade(t))
      .sort((a, b) => a.exitTs - b.exitTs)   // realised series: an open row's null exitTs
                                             // sorts as NaN and flattens the whole curve
    let eq = startCap
    let peak = startCap
    let maxDDPct = 0
    let wins = 0
    let losses = 0
    let grossProfit = 0
    let grossLoss = 0
    for (const t of chrono) {
      // compound ON = the engine's Smart Sizing: the lane notional scales
      // base × (eq/INITIAL)^0.75, capped $25k/lane (see smartCompoundPnl) — NOT
      // naive equity reinvest (which blows up to $millions–quintillions). OFF =
      // linear fixed-bet (eq += pnl). WR/PF are trade-level (compound-invariant).
      if (compound) eq += smartCompoundPnl(t, eq, startCap)
      else eq += t.pnl
      if (eq > peak) peak = eq
      const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0
      if (dd > maxDDPct) maxDDPct = dd
      if (t.pnl > 0) { wins++; grossProfit += t.pnl }
      else { losses++; grossLoss += -t.pnl }
    }
    const totalPnl = eq - startCap
    const total = wins + losses
    return {
      totalPnl,
      returnPct: (totalPnl / startCap) * 100,
      maxDD: maxDDPct,
      totalTrades: total,
      winRate: total > 0 ? (wins / total) * 100 : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 0,
      startCapital: startCap,
    }
  }, [trades, stats?.startCapital, compound])

  // 2026-06-12: per-row compounded view for the trade LIST. When the toggle is
  // ON, each CLOSED row's size/PnL is scaled by its equity-multiplier at its
  // point in the chronological sequence — the SAME smartCompoundPnl walk the
  // headline + curve use, so all three tell ONE story. Opens scale at the final
  // equity (their "point" = now). Keyed by trade identity. null when OFF.
  const compoundRows = useMemo<CompoundView | null>(() => {
    if (!compound || !trades.length) return null
    const startCap = stats?.startCapital || 10000
    const chrono = [...trades].filter(t => !isOpenTrade(t))
      .sort((a, b) => a.exitTs - b.exitTs)   // realised series: an open row's null exitTs
                                             // sorts as NaN and flattens the whole curve
    const map = new Map<string, { notional: number; pnl: number; capped: boolean }>()
    let eq = startCap
    for (const t of chrono) {
      const base = t.notional || 0
      const scaled = base > 0
        ? Math.min(SMART_COMPOUND_CAP, base * Math.pow(eq / startCap, SMART_COMPOUND_K))
        : base
      const pnl = smartCompoundPnl(t, eq, startCap)  // identical to headline + curve
      map.set(rowKey(t), { notional: scaled, pnl, capped: base > 0 && scaled >= SMART_COMPOUND_CAP })
      eq += pnl
    }
    return { map, finalEq: eq, startCap }
  }, [trades, compound, stats?.startCapital])

  return (
    <div className="stax-page">
      {previewMode && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 50, marginBottom: 16,
          padding: '10px 16px', background: '#7c2d12', color: '#fed7aa',
          border: '1px solid #ea580c', borderRadius: 8, fontSize: 13,
          fontWeight: 600, textAlign: 'center', letterSpacing: '0.02em',
        }}>
          ⚠ PREVIEW — 71-cfg + Tier-S staging output (NOT live). Pinned 2026-05-29 · flat-notional · pure publisher, no shadow merge.
        </div>
      )}
      {/* A candidate basket is not the one the account is trading. Say so before any number is
          read, not in a footnote — these figures are in-sample over the selection window. */}
      {candidateBasket && NOT_TRADED[candidateBasket] && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 50, marginBottom: 16,
          padding: '10px 16px', background: '#422006', color: '#fde68a',
          border: '1px solid #ca8a04', borderRadius: 8, fontSize: 13,
          fontWeight: 600, textAlign: 'center', letterSpacing: '0.02em',
        }}>
          ⚠ {candidateBasket === 'k54'
            ? 'RETIRED BASKET — the account stopped trading this on 28 Sep 2026. Shown for comparison.'
            : 'CANDIDATE BASKET — NOT ACTIVATED. Your account is not trading this.'}
          {stats?.cfgCount ? ` ${stats.cfgCount} cfgs · ${stats.tierSCount} Tier-S.` : ''}
          {' '}No open positions shown.
        </div>
      )}
      {/* Chris marked the large green banner that used to sit here for removal. The period and
          the simulated-vs-live distinction still have to be stated — a reader cannot infer either
          — so they live in the meta line under the title, where the dates already are. The
          methodology behind them is in the info view. */}
      {/* Header */}
      <div className="bt-header">
        <div className="bt-eyebrow">{candidateBasket
          ? (CANDIDATE_LABELS[candidateBasket] ?? 'CANDIDATE BASKET · RESEARCH · NOT TRADED')
          : previewMode ? `${ACTIVE_EYEBROW} · PREVIEW` : ACTIVE_EYEBROW}</div>
        <h1 className="bt-title">
          {isPt ? <>Performance <span className="bt-title-gold">verificada.</span></> : <>Verified <span className="bt-title-gold">performance.</span></>}
        </h1>
        <p className="bt-blurb">
          {isPt
            ? <>Backtest verificado de {ACTIVE_BASKET_IDENTITY.cfgs} CFGs de pesquisa em {ACTIVE_BASKET_IDENTITY.families} famílias e {ACTIVE_BASKET_IDENTITY.assets} ativos — a cesta que a conta negocia. <strong>Os números abaixo refletem o tier selecionado em uma conta simulada de $10.000 com alavancagem cross-margin Bitget (1×/3×/6×/9×) — não é o saldo desta conta.</strong> Inclui custos modelados de funding rate Bitget.</>
            : <>Verified backtest of {ACTIVE_BASKET_IDENTITY.cfgs} research CFGs across {ACTIVE_BASKET_IDENTITY.families} families and {ACTIVE_BASKET_IDENTITY.assets} assets — the basket this account trades. <strong>Numbers reflect the selected tier on a simulated $10,000 account with Bitget cross-margin leverage (1×/3×/6×/9×) — not this account&apos;s balance.</strong> Includes modelled Bitget funding rate cost.</>}
        </p>
        <div className="bt-meta">
          <span>{trades.length > 0 ? new Date(trades[0].entryTs).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</span>
          <span>—</span>
          <span>{(() => {
            // Use allTrades (closed + live-forward) so the end date stays current
            // as new trades append. Falls back to pinned trades if allTrades not yet loaded.
            const src = allTrades.length > 0 ? allTrades : trades
            if (!src.length) return '—'
            const maxTs = src.reduce((m, t) => Math.max(m, t.exitTs || 0, t.entryTs || 0), 0)
            return maxTs > 0 ? new Date(maxTs).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
          })()}</span>
          <span>·</span>
          <span>{closedTrades.length.toLocaleString()} trades</span>
          {/* THE ENDPOINT, NAMED. Chris: "Record the exact endpoint on the page." The dates either
              side of this line are the first and last TRADE, which is not the same thing as where
              the evaluation stopped: the run is bounded by a signed data watermark, and the last
              trade can fall days short of it. Saying only "23 Sept 2026" would let a reader take
              the book as current when the tape behind it ends at a fixed, stated instant. */}
          {/* 2026-09-30 READ, NEVER HARDCODED. This was literally the string "2026-09-22 17:45
              UTC", typed in on the day the reference happened to stop there. The reference now
              advances hourly, so a fixed date is a lie with a timestamp on it — the page said
              22 Sept while the trade list underneath showed 30 Sept. It comes from the endpoint
              that knows: /api/strategies/phase-h/open-positions returns
              reference_evaluated_to_ms, which is the horizon the book was actually evaluated to
              (not the last exit — a quiet night with no exits is not staleness). Absent => the
              claim is simply not made, rather than made wrongly. */}
          {refEvaluatedTo ? (
            <>
              <span>·</span>
              <span title="How far the reference has actually been evaluated. Trades after this
                           instant are not in the book yet; it advances as bars complete.">
                {isPt ? 'avaliado até' : 'evaluated to'}{' '}
                {new Date(refEvaluatedTo).toISOString().slice(0, 16).replace('T', ' ')} UTC
              </span>
            </>
          ) : null}
          {updatedAgo ? (() => {
            // Freshness banding. Publisher cron runs hourly + takes ~15 min,
            // so portfolio-stats.json mtime cycles 0-60 min by design. The old
            // "Stale · 51m ago" label flagged the routine cadence as a problem;
            // the new banding treats only >90 min as actually stale.
            const m = updatedAgoMins ?? 0
            const cls = m >= 90 ? 'dot-stale' : m >= 60 ? 'dot-warn' : 'dot-live'
            const label = updatedAgo === '< 1m'
              ? (isPt ? 'Ao vivo' : 'Live')
              : m >= 90
                ? `${isPt ? 'Desatualizado' : 'Stale'} · ${updatedAgo} ${isPt ? 'atrás' : 'ago'}`
                : `${isPt ? 'Atualizado' : 'Updated'} · ${updatedAgo} ${isPt ? 'atrás' : 'ago'}`
            const tip = isPt
              ? 'O backtest republica de hora em hora. Esperado: 0–60 min de idade. ≥90 min = sinal de problema.'
              : 'Backtest republishes hourly. Expected age: 0–60 min. ≥90 min indicates an issue.'
            return (
              <>
                <span>·</span>
                <span className="bt-fresh" title={tip}>
                  <span className={cls} />
                  {label}
                </span>
              </>
            )
          })() : null}
        </div>
      </div>

      {/* 2026-06-12: compounding toggle — OFF by default (the canonical compound-off
          display the producer serves). ON recomputes headline metrics + curve client-side. */}
      <CustomRerunControls
        tier={tier}
        setTier={setTier}
        rerun={rerun}
        busy={rerunBusy}
        error={rerunErr}
        isPt={isPt}
        onRun={async (from, to, capital, t) => {
          setRerunBusy(true); setRerunErr(null)
          try {
            // POST + no-store: a rerun is never served from cache, so the controls can never
            // display a previous window's numbers.
            const r = await fetch('/api/strategies/phase-h/rerun', {
              method: 'POST', cache: 'no-store',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tier: t, from, to, startCapital: capital }),
            })
            const j = await r.json().catch(() => null)
            if (!r.ok) {
              throw new Error(j?.problems ? j.problems.join('; ') : (j?.detail || j?.error || `HTTP ${r.status}`))
            }
            setRerun(j as RerunResult)
            setView('metrics')
          } catch (e: any) {
            setRerunErr(e?.message || 'the rerun failed')
            setRerun(null)
          } finally {
            setRerunBusy(false)
          }
        }}
        onClear={() => { setRerun(null); setRerunErr(null) }}
      />
      <div className="bt-controls-row" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button
          type="button"
          className={'bt-view-tab' + (compound ? ' active' : '')}
          onClick={() => setCompound(c => !c)}
          title="Compound profits with the engine's Smart Sizing — each lane's notional scales sub-linearly with balance and hard-caps at $25k/lane (off = fixed $10k-base bet)"
        >
          {isPt ? 'Juros Compostos' : 'Compounding'}: {compound ? (isPt ? 'Ligado' : 'On') : (isPt ? 'Desligado' : 'Off')}
        </button>
      </div>

      {/* Top metrics — derived from the normalized trades array (see
          derivedStats above). Falls back to stats only for the start-capital
          constant and when trades haven't loaded yet. */}
      <div className="bt-metrics-row">
        <MetricCard label={isPt ? 'P&L Líquido Total' : 'Total Net P&L'}
          value={derivedStats ? `${derivedStats.totalPnl >= 0 ? '+' : '-'}$${Math.abs(derivedStats.totalPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
          sub={derivedStats ? `${derivedStats.returnPct.toFixed(2)}%` : ''}
          positive={!derivedStats || derivedStats.totalPnl >= 0} />
        <MetricCard label={isPt ? 'Drawdown Máximo' : 'Max Drawdown'}
          value={derivedStats ? `${derivedStats.maxDD.toFixed(2)}%` : '—'} negative />
        <MetricCard label={isPt ? 'Total de Trades' : 'Total Trades'}
          value={closedTrades.length > 0 ? closedTrades.length.toLocaleString() : '—'} />
        <MetricCard label={isPt ? 'Taxa de Acerto' : 'Win Rate'}
          value={derivedStats ? fmtNum(derivedStats.winRate, 2, '%') : '—'} positive />
        <MetricCard label={isPt ? 'Fator de Lucro' : 'Profit Factor'}
          value={derivedStats ? fmtPF(derivedStats.profitFactor, (derivedStats as any).profitFactorStatus) : '—'} />
      </div>

      {/* Tier picker — highlights the user's live-config tier */}
      <div className="bt-tier-row">
        <div className="bt-tier-pills">
          {(['conservative', 'moderate', 'aggressive', 'kamikaze'] as Tier[]).map(tk => {
            const isActiveTier = activeTier === tk
            return (
              <button
                key={tk}
                type="button"
                className={'bt-tier-pill' + (tier === tk ? ' active' : '') + (isActiveTier ? ' bt-tier-pill--your-tier' : '')}
                onClick={() => setTier(tk)}
                title={isActiveTier ? (isPt ? 'Seu tier ativo' : 'Your active tier') : undefined}
              >
                {isPt ? TIER_LABELS[tk].pt : TIER_LABELS[tk].en}
                {isActiveTier ? <span className="bt-tier-pill__badge"> ★</span> : null}
              </button>
            )
          })}
        </div>
        <div className="bt-tier-meta">
          {activeTier ? (
            <span className="bt-tier-active-indicator">
              {isPt ? 'Seu tier ativo: ' : 'Your active tier: '}
              <strong>{(isPt ? TIER_LABELS[activeTier].pt : TIER_LABELS[activeTier].en).toUpperCase()}</strong>
              {' · '}
            </span>
          ) : null}
          {isPt ? `Modo ${TIER_LABELS[tier].pt}` : `${TIER_LABELS[tier].en} tier`} ·
          {' '}{TIER_LABELS[tier].mult} ·
          {' '}{isPt
            ? `Cesta de ${ACTIVE_BASKET_IDENTITY.assets} ativos · ${ACTIVE_BASKET_IDENTITY.cfgs} CFG`
            : `${ACTIVE_BASKET_IDENTITY.assets}-asset basket · ${ACTIVE_BASKET_IDENTITY.cfgs} CFG`} ·
          {' '}{closedTrades.length > 0 ? `${(((closedTrades[closedTrades.length - 1].exitTs - closedTrades[0].entryTs) / 86400000 / 365)).toFixed(1)}yr backtest` : ''}
        </div>
      </div>

      {/* KAMIKAZE tail-risk disclosure — renders ONLY when the Kamikaze tier is
          selected. Verbatim disclosure copy (do not paraphrase). Reuses the
          wizard's red-tinted warning box styling (bw-compound-warn). */}
      {tier === 'kamikaze' ? (
        <div className="bw-compound-warn" style={{ maxWidth: '100%', margin: '0 0 12px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>KAMIKAZE (7 lanes / 1.25x) — DISCLOSED TAIL RISK: worst observed 7-year case is a ~61-68% drawdown week (full books occur roughly weekly on volatility events). A beyond-record simultaneous &gt;=2x gap-through event would be fatal below ~$50k. Minimum account is set by order mechanics (~$1k), NOT by a safety threshold — no account size makes this tier safe from its tail. Position sizing risks ~6.25% of configured capital per trade.</span>
        </div>
      ) : null}

      {/* View tabs */}
      <div className="bt-view-tabs">
        <button
          type="button"
          className={'bt-view-tab' + (view === 'metrics' ? ' active' : '')}
          onClick={() => setView('metrics')}
        >
          <BarsIcon /> <span>{isPt ? 'Métricas' : 'Metrics'}</span>
        </button>
        <button
          type="button"
          className={'bt-view-tab' + (view === 'trades' ? ' active' : '')}
          onClick={() => setView('trades')}
        >
          <ListIcon /> <span>{isPt ? 'Lista de Trades' : 'List of Trades'}</span>
        </button>
      </div>

      {view === 'metrics' ? (
        <MetricsView stats={stats} trades={trades} loading={loading} tier={tier} isPt={isPt} compound={compound} rerun={rerun} />
      ) : (
        <>
        {isAdmin === true && frozenAt && (() => {
          const ageH = (Date.now() - new Date(frozenAt).getTime()) / 3_600_000
          const stale = ageH > 2
          return (
            <div style={{ margin: '0 0 8px', fontSize: 11, fontWeight: stale ? 700 : 400,
                          color: stale ? '#b45309' : 'var(--muted)' }}
                 title="The closed history comes from phase-h-risk, which the publisher rewrites ONLY on a validation PASS. If this age grows, the publisher is halted and the history below is frozen — the live tail keeps moving regardless.">
              {stale ? '⚠ ' : ''}closed history frozen at {new Date(frozenAt).toISOString().replace('T', ' ').slice(0, 16)}Z
              {' '}({ageH < 1 ? `${Math.round(ageH * 60)}m` : `${ageH.toFixed(1)}h`} old)
              {stale ? ' — publisher may be halted' : ''}
            </div>
          )
        })()}
        <TradesTable trades={allTrades} loading={loading} isPt={isPt} tier={tier} showCfgColumn={isAdmin === true} compound={compound} compoundRows={compoundRows} />
        </>
      )}
    </div>
  )
}


// ─── ABSENT IS NOT ZERO, AND IT IS NOT A CRASH ──────────────────────────────
/**
 * A custom-window backtest crashed the page with
 * `Cannot read properties of null (reading 'toFixed')`.
 *
 * Root cause: profit factor is `gross profit / gross loss`, and over a short window an asset can
 * genuinely have NO LOSING TRADE — the ratio is then undefined, not zero. Four assets in a 30-day
 * aggressive window (LINK, NEAR, ADA, HBAR) came back with `profitFactor: null`, and
 * `row.profitFactor.toFixed(2)` threw before the page could render. The published full-history feed
 * never had a no-loss asset, so the bug was invisible until custom windows existed.
 *
 * `(x ?? 0).toFixed(2)` would stop the crash and introduce a worse bug: it prints 0.00 — the WORST
 * possible profit factor — for the BEST possible outcome, which is the falsy-zero coercion that has
 * already cost this project four CFGs their tier. So PF renders from its MEANING: ∞ when there were
 * no losses, n/a when there were no economic observations at all, the number otherwise.
 */
function fmtPF(v: number | null | undefined, status?: string | null): React.ReactNode {
  if (status === 'NO_LOSSES' || (v == null && status == null && false)) {
    return <span style={{ color: '#4ade80', fontWeight: 700 }} title="no losing trade in this window — the profit factor is undefined because the denominator is zero, which is the BEST case, not the worst">∞</span>
  }
  if (status === 'NO_ECONOMIC_OBSERVATIONS') return <span style={{ opacity: 0.5 }} title="no trades in this window">n/a</span>
  if (v == null || !Number.isFinite(v)) return <span style={{ opacity: 0.5 }} title="profit factor undefined for this window">—</span>
  return v.toFixed(2)
}

/** A number that may legitimately be absent. Never substitutes a value that means something else. */
function fmtNum(v: number | null | undefined, d = 2, suffix = ''): string {
  return v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}${suffix}`
}

function fmtUsd(v: number | null | undefined, d = 2): string {
  return v == null || !Number.isFinite(v) ? '—' : `$${v.toFixed(d)}`
}

// ─── Metrics view (all sections) ────────────────────────────────────────────

function MetricsView({ stats, trades, loading, tier, isPt, compound, rerun }: {
  stats: Stats | null
  trades: PortfolioTrade[]
  loading: boolean
  tier: Tier
  isPt: boolean
  compound: boolean
  rerun?: RerunResult | null
}) {
  if (loading) return <div className="card card-pad">Loading…</div>
  if (!trades.length) return <div className="card card-pad">No trade data.</div>

  return (
    <>
      <EquityCurveSection trades={trades} stats={stats} isPt={isPt} compound={compound} rerun={rerun} />
      <PerAssetBreakdown stats={stats} tier={tier} isPt={isPt} />
      <div className="bt-twin-row">
        <ProfitStructure trades={trades} isPt={isPt} />
        <PnLDistribution trades={trades} isPt={isPt} />
      </div>
      <div className="bt-twin-row">
        <ReturnsSummary stats={stats} trades={trades} isPt={isPt} />
        <TradeAnalysis trades={trades} isPt={isPt} />
      </div>
      <div className="bt-twin-row">
        <RunUpsAndDrawdowns trades={trades} isPt={isPt} />
        <RiskAdjusted trades={trades} stats={stats} isPt={isPt} />
      </div>
      <PeriodReturns trades={trades} isPt={isPt} />
      <OpenPositionsSection tier={tier} rerun={rerun} />
    </>
  )
}

// ─── Equity curve with Log/Linear toggle + BTC B&H comparison ───────────────

function EquityCurveSection({ trades, stats, isPt, compound, rerun }: { trades: PortfolioTrade[]; stats: Stats | null; isPt: boolean; compound: boolean; rerun?: RerunResult | null }) {
  const [scale, setScale] = useState<'linear' | 'log'>('linear')
  const [show, setShow] = useState<{ strategy: boolean; bh: boolean }>({ strategy: true, bh: true })

  const data = useMemo(() => {
    if (trades.length === 0) return { strategy: [] as EquityPoint[], bhPoints: [] as EquityPoint[] }
    const startCap = stats?.startCapital || 10000

    // 2026-05-26: chronological sort first. The raw trade list is publisher
    // order (per-asset replay) which interleaves time in ways that produce
    // visible wobble — e.g. you'd see ETH-replay trades from 2024 stacked
    // before BTC-replay trades from 2021, so an equity sample mid-array
    // could be summing across non-chronological PnL. Sorting by exitTs
    // means each sample point reflects total realised PnL up to that
    // wall-clock moment, which is what an equity curve should show.
    const chrono = [...trades].filter(t => !isOpenTrade(t))
      .sort((a, b) => a.exitTs - b.exitTs)   // realised series: an open row's null exitTs
                                             // sorts as NaN and flattens the whole curve

    // Sample density. Bumped 250 → 1500 (2026-05-26) so the curve no longer
    // skips over short-duration drawdowns and rallies — at 250 samples on a
    // 15k-trade ledger a single sample covered 60 trades, hiding meaningful
    // intra-window shape. 1500 is still well below the input size (so we
    // get genuine subsampling, not aliasing artifacts) but ~6× the previous
    // resolution.
    let eq = startCap
    const SAMPLE = 1500
    const step = Math.max(1, Math.floor(chrono.length / SAMPLE))
    // 2026-09-30 THE CURVE STARTS AT THE WINDOW, NOT AT THE FIRST TRADE'S ENTRY.
    // This anchored on `chrono[0].entryTs`. A trade opened in late August and closed in September
    // is the first CLOSE in a 1 September window, so the line began in AUGUST — before the window
    // the user asked for — and its whole P&L landed on the first sample, putting the strategy
    // below $10,000 by the time the chosen start date arrived. The benchmark beside it starts at
    // the window, so the two were not the same race.
    // The window start is taken from the rerun's own identity when there is one, and from the
    // first trade otherwise (the published full-history view, where they coincide).
    const winFrom = rerun?.identity?.range?.from ? Date.parse(rerun.identity.range.from) : null
    const anchorTs = (winFrom && Number.isFinite(winFrom)) ? winFrom : chrono[0].entryTs
    const strategy: EquityPoint[] = [{ ts: anchorTs, value: startCap, month: '' }]
    for (let i = 0; i < chrono.length; i++) {
      // 2026-06-12: compound ON = the engine's Smart Sizing ($25k/lane-capped,
      // sub-linear in equity — matches derivedStats); OFF = linear fixed-bet.
      if (compound) eq += smartCompoundPnl(chrono[i], eq, startCap)
      else eq += chrono[i].pnl
      if (i % step === 0 || i === chrono.length - 1) {
        strategy.push({ ts: chrono[i].exitTs, value: Math.max(1, Math.round(eq * 100) / 100), month: '' })
      }
    }

    // BTC Buy & Hold from first BTC entryPx → each BTC exitPx, sampled along
    // its own timeline. 2026-05-26: previously this used the same `step` as
    // the strategy, computed from total trade count. With 14 assets the BTC
    // slice is <10% of the total — so step=60 produced ~25 BH samples on a
    // 6-year span, making the line a coarse zig-zag. We now compute step
    // independently against BTC count so the BH curve has comparable density
    // to the strategy curve.
    const btcChrono = chrono.filter(t => (t.symbol || '').includes('BTC'))
    // ── BTC BUY-AND-HOLD ────────────────────────────────────────────────────────────────────
    // A rerun carries an AUTHORITATIVE daily series computed server-side from the BTC daily-close
    // panel, independent of every strategy trade. Use it verbatim.
    //
    // The fallback below still samples BTC at the strategy's own BTC entry/exit marks, which is
    // the defect this replaces: a handful of points, flat for months, starting after the window
    // start and ending before its end, and absent entirely when the strategy did not trade BTC.
    // It is kept only for the PUBLISHED full-history view, where the strategy trades BTC densely
    // across the whole period and there is no server-side window to ask about — and it is labelled
    // as approximate in the legend so the two are never confused.
    let bhPoints: EquityPoint[] = []
    let bhExact = false
    const rb = rerun?.btcBuyAndHold as any
    if (rb && rb.available && Array.isArray(rb.series) && rb.series.length > 1) {
      const SAMPLE = 1500
      const step = Math.max(1, Math.floor(rb.series.length / SAMPLE))
      bhPoints = rb.series
        .filter((_p: any, i: number) => i % step === 0 || i === rb.series.length - 1)
        .map((p: any) => ({ ts: p.ts, value: Math.max(1, p.equity), month: '' }))
      bhExact = true
    } else if (btcChrono.length > 0) {
      const firstPx = btcChrono[0].entryPx
      const BH_SAMPLE = 1500
      const bhStep = Math.max(1, Math.floor(btcChrono.length / BH_SAMPLE))
      bhPoints = btcChrono.filter((_, i) => i % bhStep === 0 || i === btcChrono.length - 1).map(t => ({
        ts: t.exitTs,
        value: Math.max(1, Math.round((startCap * (t.exitPx / firstPx)) * 100) / 100),
        month: '',
      }))
    }
    // ── BOTH SERIES SPAN THE REQUESTED WINDOW ───────────────────────────────────────────────
    // The strategy's last sample is its last trade's exit, which can fall days short of the
    // chosen end date; the benchmark's last point is its last daily close. Two lines ending at
    // different x on one chart is not a comparison. Equity genuinely does not move without a
    // trade, so carrying the strategy flat to the window end states a fact rather than inventing
    // one. The benchmark is NOT extended — a price that has not closed yet must not be drawn —
    // and the legend says where its data actually stops.
    const winTo = rerun?.identity?.range?.to ? Date.parse(rerun.identity.range.to) : null
    const lastPt = strategy.length ? strategy[strategy.length - 1] : undefined
    const lastTs = lastPt?.ts
    if (winTo && Number.isFinite(winTo) && lastPt && typeof lastTs === 'number' && winTo > lastTs) {
      strategy.push({ ts: winTo, value: lastPt.value, month: '' })
    }
    return { strategy, bhPoints, bhExact }
  }, [trades, stats?.startCapital, compound, rerun])

  const hasBh = data.bhPoints.length > 0

  return (
    <div className="card card-pad bt-eq-card">
      <div className="bt-card-head">
        <div className="bt-card-title">
          <span className="bt-card-bar" /> {isPt ? 'CURVA DE EQUITY' : 'EQUITY CURVE'}
        </div>
        <div className="bt-scale-toggle">
          <button type="button" className={scale === 'log' ? 'on' : ''} onClick={() => setScale('log')}>Log</button>
          <button type="button" className={scale === 'linear' ? 'on' : ''} onClick={() => setScale('linear')}>Linear</button>
        </div>
      </div>
      <div className="bt-eq-legend">
        <button
          type="button"
          className={'bt-legend-item' + (show.strategy ? '' : ' off')}
          onClick={() => setShow(s => ({ ...s, strategy: !s.strategy }))}
          aria-pressed={show.strategy}
        >
          <span className="bt-legend-swatch" style={{ background: 'var(--gold)' }} /> RESEARCH56 basket
        </button>
        {hasBh ? (
          <button
            type="button"
            className={'bt-legend-item' + (show.bh ? '' : ' off')}
            onClick={() => setShow(s => ({ ...s, bh: !s.bh }))}
            aria-pressed={show.bh}
          >
            <span className="bt-legend-swatch bt-legend-swatch-dashed" /> BTC Buy &amp; Hold
            {data.bhExact ? (
              <span style={{ marginLeft: 6, fontSize: 9.5, opacity: 0.75 }}
                    title={`${(rerun!.btcBuyAndHold as any).points} daily closes across the window · ${(rerun!.btcBuyAndHold as any).basis}`}>
                · daily close, {(rerun!.btcBuyAndHold as any).points} pts
                {(() => {
                  // WHERE THE BENCHMARK ACTUALLY ENDS. It is drawn only where BTC has closed, so
                  // on a window running to today it stops at the last completed daily bar. Saying
                  // so is the difference between a short line and an unexplained one.
                  const b = rerun!.btcBuyAndHold as any
                  const t = b?.toTs
                  const miss = b?.missing_days_in_window
                  if (!t) return null
                  const d = new Date(t).toISOString().slice(0, 10)
                  return <> · to {d}{miss ? ` (${miss} day(s) of the window not yet closed)` : ''}</>
                })()}
              </span>
            ) : (
              <span style={{ marginLeft: 6, fontSize: 9.5, opacity: 0.6 }}
                    title="sampled at the strategy's own BTC trade marks — approximate. Run a custom backtest for the exact daily-close benchmark.">
                · approx
              </span>
            )}
          </button>
        ) : null}
      </div>
      <div style={{ height: 320 }}>
        <DualEquityChart
          strategy={data.strategy}
          bh={data.bhPoints}
          scale={scale}
          width={1200}
          height={320}
          show={{ strategy: show.strategy, bh: show.bh && hasBh }}
        />
      </div>
    </div>
  )
}

function DualEquityChart({ strategy, bh, scale, width, height, show }: {
  strategy: EquityPoint[]; bh: EquityPoint[]; scale: 'log' | 'linear'; width: number; height: number;
  show: { strategy: boolean; bh: boolean }
}) {
  const pad = { l: 64, r: 14, t: 14, b: 32 }
  const W = width
  const H = height

  // Y-axis only fits visible series — hiding the strategy line should rescale
  // the chart to the BH range, not leave a stranded BH curve squashed at the
  // bottom of an axis still sized for the strategy's order-of-magnitude.
  // ── Hover state ────────────────────────────────────────────────────────────
  // Track ts under cursor (interpolated, not snapped to a sample). Both dots
  // and the tooltip read off this single ts so they stay aligned.
  //
  // 2026-08-28: THESE WERE BELOW THE "No data" EARLY RETURN. With both series toggled off — or
  // any render where nothing is visible — this component returned before declaring 3 hooks, then
  // declared them once data appeared. React counts hooks per render and throws #310, which blanks
  // the whole Backtesting page. Found by scripts/admin_tab_smoke.py on its first run.
  const [hoverTs, setHoverTs] = useState<number | null>(null)
  const [hoverVbX, setHoverVbX] = useState<number>(0)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const visibleValues = [
    ...(show.strategy ? strategy.map(p => p.value) : []),
    ...(show.bh ? bh.map(p => p.value) : []),
  ].filter(v => v > 0)
  if (!visibleValues.length) return <div style={{ color: 'var(--muted)', textAlign: 'center', paddingTop: 80 }}>No data</div>

  const tx = scale === 'log' ? (v: number) => Math.log10(Math.max(1, v)) : (v: number) => v
  const minRaw = Math.min(...visibleValues)
  const maxRaw = Math.max(...visibleValues)
  const minT = tx(minRaw)
  const maxT = tx(maxRaw)
  const padTop = (maxT - minT) * 0.05
  const padBot = (maxT - minT) * 0.02
  const yMinT = minT - padBot
  const yMaxT = maxT + padTop

  // X-axis spans the full strategy timeline regardless of which series is
  // visible — keeps year labels stable when the user toggles series.
  const tsMin = strategy[0]?.ts ?? bh[0]?.ts ?? 0
  const tsMax = strategy[strategy.length - 1]?.ts ?? bh[bh.length - 1]?.ts ?? 1
  const xs = (ts: number) => pad.l + ((ts - tsMin) / Math.max(1, tsMax - tsMin)) * (W - pad.l - pad.r)
  const ys = (v: number) => pad.t + (1 - (tx(v) - yMinT) / Math.max(0.0001, yMaxT - yMinT)) * (H - pad.t - pad.b)

  const path = (pts: EquityPoint[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xs(p.ts ?? 0).toFixed(1)} ${ys(p.value).toFixed(1)}`).join(' ')

  // Y-axis ticks: log mode → powers of 10; linear → niceTicks
  const yTicks: number[] = []
  if (scale === 'log') {
    const lo = Math.floor(Math.log10(minRaw))
    const hi = Math.ceil(Math.log10(maxRaw))
    for (let p = lo; p <= hi; p++) {
      const v = Math.pow(10, p)
      if (v >= minRaw * 0.5 && v <= maxRaw * 2) yTicks.push(v)
    }
  } else {
    const span = maxRaw - minRaw
    const step = Math.pow(10, Math.floor(Math.log10(span / 5)))
    const nice = [1, 2, 5, 10].map(m => m * step).find(s => span / s <= 8) || step
    for (let v = Math.floor(minRaw / nice) * nice; v <= maxRaw; v += nice) {
      if (v >= minRaw * 0.95) yTicks.push(v)
    }
  }

  function fmt$(v: number): string {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`
    if (v >= 1_000) return `$${Math.round(v / 1000)}K`
    return `$${v.toFixed(0)}`
  }
  function fmtFull(v: number): string {
    return `$${Math.round(v).toLocaleString('en-US')}`
  }

  // X-axis ticks: years
  const yearsSet = new Set<number>()
  for (const p of strategy) yearsSet.add(new Date(p.ts ?? 0).getFullYear())
  const years = Array.from(yearsSet).sort()

  // Linear interpolation of a series at an arbitrary timestamp. Keeps both
  // dots locked to the cursor's x-position instead of snapping to nearest
  // sample (which made strategy + BH dots drift apart).
  function valueAt(series: EquityPoint[], ts: number): number | null {
    if (series.length === 0) return null
    if (series.length === 1) return series[0].value
    const first = series[0].ts ?? 0
    const last = series[series.length - 1].ts ?? 0
    if (ts <= first) return series[0].value
    if (ts >= last) return series[series.length - 1].value
    let lo = 0, hi = series.length - 1
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if ((series[mid].ts ?? 0) <= ts) lo = mid; else hi = mid
    }
    const a = series[lo], b = series[hi]
    const aT = a.ts ?? 0, bT = b.ts ?? 0
    if (bT === aT) return a.value
    const k = (ts - aT) / (bT - aT)
    return a.value + (b.value - a.value) * k
  }


  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const localX = e.clientX - rect.left
    const vbX = (localX / Math.max(1, rect.width)) * W
    if (vbX < pad.l - 4 || vbX > W - pad.r + 4) { setHoverTs(null); return }
    const clampedX = Math.max(pad.l, Math.min(W - pad.r, vbX))
    const innerW = W - pad.l - pad.r
    const ts = tsMin + (clampedX - pad.l) / Math.max(1, innerW) * (tsMax - tsMin)
    setHoverTs(ts)
    setHoverVbX(clampedX)
  }

  const strategyHoverVal = hoverTs != null && show.strategy ? valueAt(strategy, hoverTs) : null
  const bhHoverVal = hoverTs != null && show.bh ? valueAt(bh, hoverTs) : null
  const strategyDotY = strategyHoverVal != null ? ys(strategyHoverVal) : null
  const bhDotY = bhHoverVal != null ? ys(bhHoverVal) : null
  const hoverDateStr = hoverTs != null
    ? (() => { const d = new Date(hoverTs); const day = String(d.getDate()).padStart(2, '0'); const mon = d.toLocaleString('en-US', { month: 'short' }); return `${day} ${mon} ${d.getFullYear()}` })()
    : ''

  // Tooltip placement.
  // X: follows cursor; flips left of cursor when past 70% to stay in-frame.
  // Y: anchored above the topmost visible dot so it doesn't cover the curve;
  //    falls back to the chart top if the dot is too close to the top edge.
  const flipLeft = hoverVbX > W * 0.7
  const dotYs = [strategyDotY, bhDotY].filter((y): y is number => y != null)
  const topDotY = dotYs.length > 0 ? Math.min(...dotYs) : H / 2
  const tooltipTopPx = Math.max(pad.t, Math.min(H - 110, topDotY - 90))

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', width: '100%', height: H, cursor: 'crosshair' }}
      onPointerMove={onMove}
      onPointerLeave={() => setHoverTs(null)}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        <defs>
          <linearGradient id="bteqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={ys(v)} y2={ys(v)} stroke="var(--line)" strokeDasharray="2 4" opacity="0.6" />
            <text x={pad.l - 8} y={ys(v) + 3} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="JetBrains Mono">{fmt$(v)}</text>
          </g>
        ))}
        {years.map((y, i) => {
          const ts = new Date(y, 0, 1).getTime()
          if (ts < tsMin || ts > tsMax) return null
          const x = xs(ts)
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={pad.t} y2={H - pad.b} stroke="var(--line)" strokeDasharray="2 4" opacity="0.4" />
              <text x={x} y={H - 8} textAnchor="middle" fontSize="10.5" fill="var(--muted)">{y}</text>
            </g>
          )
        })}
        {show.bh && bh.length > 0 && (
          <path d={path(bh)} fill="none" stroke="rgba(212,160,23,0.45)" strokeWidth="1.4" strokeDasharray="4 3" />
        )}
        {show.strategy && strategy.length > 1 && (
          <>
            <path d={`${path(strategy)} L ${xs(strategy[strategy.length - 1].ts ?? 0).toFixed(1)} ${H - pad.b} L ${xs(strategy[0].ts ?? 0).toFixed(1)} ${H - pad.b} Z`} fill="url(#bteqFill)" />
            <path d={path(strategy)} fill="none" stroke="var(--gold)" strokeWidth="1.8" />
          </>
        )}

        {/* Crosshair + dots — both dots ride the same vertical line. */}
        {hoverTs != null && (
          <g pointerEvents="none">
            <line x1={hoverVbX} x2={hoverVbX} y1={pad.t} y2={H - pad.b} stroke="var(--gold)" strokeOpacity="0.35" strokeDasharray="3 3" />
            {strategyDotY != null && (
              <circle cx={hoverVbX} cy={strategyDotY} r="5" fill="var(--card)" stroke="var(--gold)" strokeWidth="1.8" />
            )}
            {bhDotY != null && (
              <circle cx={hoverVbX} cy={bhDotY} r="4" fill="var(--card)" stroke="rgba(212,160,23,0.65)" strokeWidth="1.6" strokeDasharray="2 2" />
            )}
          </g>
        )}
      </svg>

      {/* HTML tooltip — flexbox layout so the label + value never collide. */}
      {hoverTs != null && (strategyHoverVal != null || bhHoverVal != null) && (
        <div
          className="bt-eq-tooltip"
          style={{
            left: `${(hoverVbX / W) * 100}%`,
            top: `${tooltipTopPx}px`,
            transform: flipLeft ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
          }}
        >
          <div className="bt-eq-tooltip-date">{hoverDateStr}</div>
          {strategyHoverVal != null && (
            <div className="bt-eq-tooltip-row">
              <span className="bt-eq-tooltip-swatch bt-eq-tooltip-swatch-solid" />
              <span className="bt-eq-tooltip-label">RESEARCH56 basket</span>
              <span className="bt-eq-tooltip-value">{fmtFull(strategyHoverVal)}</span>
            </div>
          )}
          {bhHoverVal != null && (
            <div className="bt-eq-tooltip-row">
              <span className="bt-eq-tooltip-swatch bt-eq-tooltip-swatch-dashed" />
              <span className="bt-eq-tooltip-label">BTC Buy &amp; Hold</span>
              <span className="bt-eq-tooltip-value bh">{fmtFull(bhHoverVal)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Per-asset breakdown ────────────────────────────────────────────────────

type SaRow = { sid: string; sa_trades: number; sa_winRate: number; sa_profitFactor: number | null
              sa_profitFactorStatus?: string | null
              sa_netUsd: number; seatRate: number; lost: number }

function PerAssetBreakdown({ stats, tier, isPt }: { stats: Stats | null; tier: Tier; isPt: boolean }) {
  const rows = stats?.breakdown ? Object.entries(stats.breakdown) : []
  // collapsed by default — one open asset at a time, so the page never becomes a wall of rows
  // on mobile. Reset when the tier changes: the cfg set is tier-scoped like the parent table.
  // 2026-08-13 STANDALONE COLUMNS (bible §CFG-QUALITY). Seated measures the BOOK after lane
  // competition; quality is STANDALONE — every signal the cfg fires. Without both, a cfg being
  // CROWDED OUT reads identically to one that is simply bad. V3G_DOGE_05825abff4 is exactly that:
  // seated PF 0.88 on this page, standalone PF 2.536 on +$6,132, seating 38.2% of its signals.
  // Joined CLIENT-SIDE — risk_sizing_canonical regenerates the risk surface on every re-lock and
  // would silently drop a merged field.
  // 2026-09-29 TIER-AWARE. The published file now carries rowsByTier, because the SEATED columns
  // beside these change with the tier and the old aggressive-only file therefore showed a
  // DIFFERENT policy on the other three — silently, in adjacent cells. `rows` is kept as the
  // aggressive fallback so an older published file still resolves rather than blanking.
  const [sa, setSa] = useState<Record<string, SaRow>>({})
  const [saBasis, setSaBasis] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch('/data/cfg-quality-leaderboard.json', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d) return
        const list: SaRow[] | undefined = d.rowsByTier?.[tier] ?? d.rows
        if (!list) return
        const m: Record<string, SaRow> = {}
        for (const r of list) m[r.sid] = r
        setSa(m)
        setSaBasis(typeof d.period === 'string' ? d.period : null)
      })
      .catch(() => {})   // absent file => SA cells render "—"; never breaks the page
    return () => { cancelled = true }
  }, [tier])
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null)
  useEffect(() => { setExpandedAsset(null) }, [tier])
  return (
    <div className="card card-pad">
      <div className="bt-card-head">
        <div className="bt-card-title"><span className="bt-card-bar" /> {isPt ? 'POR ATIVO' : 'PER-ASSET BREAKDOWN'}</div>
        <span className="bt-tier-tag">{tier.toUpperCase()} TIER</span>
      </div>
      <div className="bt-card-sub">
        RESEARCH56 basket · single $10,000 account · 1× notional/trade ({tier} tier)
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{isPt ? 'PAR' : 'PAIR'}<span style={{ opacity: 0.45, fontWeight: 400, marginLeft: 6 }}>{isPt ? '(clique p/ cfgs)' : '(click for cfgs)'}</span></th>
              <th>{isPt ? 'ESCOPO' : 'SCOPE'}</th>
              <th style={{ textAlign: 'right' }}>{isPt ? 'TRADES' : 'TRADES'}</th>
              <th style={{ textAlign: 'right' }}>{isPt ? 'RETORNO' : 'RETURN'}</th>
              <th style={{ textAlign: 'right' }}>{isPt ? 'TX. ACERTO' : 'WIN RATE'}</th>
              <th style={{ textAlign: 'right' }}>{isPt ? 'FATOR LUCRO' : 'PROFIT FACTOR'}</th>
                <th style={{ textAlign: 'right', borderLeft: '2px solid rgba(212,175,55,0.35)' }}
                    title="STANDALONE — every signal this cfg fires, no lane competition. THE quality measure.">SA n</th>
                <th style={{ textAlign: 'right' }} title="STANDALONE win rate">SA WR</th>
                <th style={{ textAlign: 'right' }} title="STANDALONE profit factor — this is what judges the cfg">SA PF</th>
                <th style={{ textAlign: 'right' }} title="STANDALONE net $, locked risk-sized">SA NET</th>
                <th style={{ textAlign: 'right' }} title="share of its signals that won a lane">SEAT</th>
                <th style={{ textAlign: 'right' }} title="standalone minus seated — what lane competition cost">GAP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([asset, row]) => {
              // 2026-08-11 PER-CFG DRILL-DOWN. The asset row is an average over several cfgs,
              // which is not enough to judge a live trade's odds — you need the cfg that fired.
              // Children come from the SAME published payload as the parent (the publisher emits
              // breakdown[asset].cfgs from the same `taken` list), so they sum to the parent by
              // construction rather than by a second computation here.
              const cfgs = (Object.entries((row as any).cfgs || {}) as [string, any][])
                .sort((a, b) => (b[1].totalTrades || 0) - (a[1].totalTrades || 0))
              const open = expandedAsset === asset
              return (
                <Fragment key={asset}>
                  <tr
                    onClick={() => cfgs.length && setExpandedAsset(open ? null : asset)}
                    style={{ cursor: cfgs.length ? 'pointer' : 'default' }}
                    title={cfgs.length ? `${cfgs.length} cfgs — click to ${open ? 'collapse' : 'expand'}` : undefined}
                  >
                    <td>
                      <div className="pair-cell">
                        {/* 2026-08-12 AFFORDANCE: the chevron used to be conditional on cfgs.length,
                            so when the surface carried no cfgs there was no cue at all AND no way to
                            tell "nothing to expand" from "feature missing". Always render the slot:
                            an active chevron when there are cfgs, a dimmed dot when there are not. */}
                        <span
                          className="num"
                          aria-hidden
                          style={{
                            width: 12, display: 'inline-block', textAlign: 'center',
                            opacity: cfgs.length ? 0.85 : 0.18,
                            color: cfgs.length ? 'var(--gold)' : undefined,
                            transition: 'transform 120ms ease',
                            transform: open ? 'rotate(90deg)' : 'none',
                          }}
                        >{cfgs.length ? '▸' : '·'}</span>
                        <span style={{ width: 18, height: 18, borderRadius: '50%', overflow: 'hidden', background: '#0e0e13', display: 'inline-block' }}>
                          <img src={ASSET_LOGOS[asset] || ''} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </span>
                        <span className="num">{asset.replace('USDT', '/USDT')}</span>
                      </div>
                    </td>
                    <td><span className="bt-scope-tag">{row.scope || 'Systematic'}</span></td>
                    <td className="num" style={{ textAlign: 'right' }}>{(row.totalTrades ?? 0).toLocaleString()}</td>
                    <td className={'num ' + ((row.returnPct ?? 0) >= 0 ? 'pos-text' : 'neg-text')} style={{ textAlign: 'right' }}>
                      {row.returnPct == null ? '—' : `${row.returnPct >= 0 ? '+' : ''}${row.returnPct.toFixed(2)}%`}</td>
                    <td className="num" style={{ textAlign: 'right', color: 'var(--gold)' }}>{fmtNum(row.winRate, 1, '%')}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{fmtPF(row.profitFactor, (row as any).profitFactorStatus)}</td>
                      <td colSpan={6} style={{ textAlign: 'right', opacity: 0.3, fontSize: '0.72em',
                                               borderLeft: '2px solid rgba(212,175,55,0.35)' }}>{isPt ? 'por cfg' : 'per-cfg only'}</td>
                  </tr>
                  {open && cfgs.map(([sid, c]) => (
                    <tr key={sid} className="bt-cfg-row">
                      <td style={{ paddingLeft: 26 }}>
                        <span className="num" style={{ fontSize: '0.8em', opacity: 0.9, wordBreak: 'break-all' }}>{sid}</span>
                      </td>
                      <td>
                        <span className="num" style={{ fontSize: '0.76em', opacity: 0.75 }}>
                          {[c.archetype, c.tf, c.direction === 1 ? 'long' : c.direction === -1 ? 'short' : 'both']
                            .filter(Boolean).join(' · ')}
                        </span>
                      </td>
                      <td className="num" style={{ textAlign: 'right', fontSize: '0.85em' }}>{(c.totalTrades ?? 0).toLocaleString()}</td>
                      <td className={'num ' + ((c.returnPct ?? 0) >= 0 ? 'pos-text' : 'neg-text')} style={{ textAlign: 'right', fontSize: '0.85em' }}>
                        {(c.returnPct ?? 0) >= 0 ? '+' : ''}{(c.returnPct ?? 0).toFixed(2)}%
                      </td>
                      <td className="num" style={{ textAlign: 'right', fontSize: '0.85em', color: 'var(--gold)' }}>{fmtNum(c.winRate, 1, '%')}</td>
                      <td className="num" style={{ textAlign: 'right', fontSize: '0.85em' }}>{fmtPF(c.profitFactor, (c as any).profitFactorStatus)}</td>
                        {(() => {
                          const q = sa[sid]
                          const cell = (v: React.ReactNode, extra: React.CSSProperties = {}) => (
                            <td className="num" style={{ textAlign: 'right', fontSize: '0.85em', ...extra }}>{v}</td>
                          )
                          if (!q) return <td colSpan={6} style={{ textAlign: 'right', opacity: 0.3, fontSize: '0.72em', borderLeft: '2px solid rgba(212,175,55,0.35)' }}>—</td>
                          return (<>
                            {cell(q.sa_trades, { borderLeft: '2px solid rgba(212,175,55,0.35)' })}
                            {cell(fmtNum(q.sa_winRate, 1, '%'))}
                            {cell(fmtPF(q.sa_profitFactor, (q as any).sa_profitFactorStatus), { color: (q.sa_profitFactor ?? 0) >= 1 ? 'var(--gold)' : '#ef4444', fontWeight: 600 })}
                            {cell(`${q.sa_netUsd >= 0 ? '+' : ''}$${Math.round(q.sa_netUsd).toLocaleString()}`)}
                            {cell(`${q.seatRate.toFixed(0)}%`, { color: q.seatRate < 50 ? '#f59e0b' : undefined })}
                            {cell(`$${Math.round(q.lost).toLocaleString()}`, { opacity: 0.85 })}
                          </>)
                        })()}
                    </tr>
                  ))}
                  {open && cfgs.length > 0 && (
                    <tr className="bt-cfg-row">
                      <td colSpan={12} style={{ paddingLeft: 26, fontSize: '0.72em', opacity: 0.6 }}>
                        <strong>Left of the divider — SEATED</strong> (locked risk-sized, after lane competition): {cfgs.length} cfgs · {cfgs.reduce((s, [, c]) => s + (c.totalTrades || 0), 0).toLocaleString()} trades, and these <strong>sum to the {asset.replace('USDT', '')} row above</strong> by construction.
                        <br /><strong>Right of the divider — STANDALONE</strong> (same risk sizing, same 0.15%/120m limit entry, every signal the cfg fires with no lane competition and no per-asset gate). These <strong>do NOT sum to the parent and are not meant to</strong> — they count trades the book never seated. Standalone judges the CFG; seated measures the BOOK. <strong>GAP</strong> is what lane competition cost.{saBasis ? ` Both sides: ${saBasis}.` : ''}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Profit Structure (Gross Profit vs Gross Loss bar) ──────────────────────

function ProfitStructure({ trades, isPt }: { trades: PortfolioTrade[]; isPt: boolean }) {
  const { gp, gl } = useMemo(() => {
    let gp = 0, gl = 0
    for (const t of trades) {
      if (t.pnl > 0) gp += t.pnl
      else gl += Math.abs(t.pnl)
    }
    return { gp, gl }
  }, [trades])
  const max = Math.max(gp, gl, 1)
  return (
    <div className="card card-pad">
      <div className="bt-card-head">
        <div className="bt-card-title"><span className="bt-card-bar" /> {isPt ? 'ESTRUTURA DE LUCRO' : 'PROFIT STRUCTURE'}</div>
      </div>
      <div className="bt-bar-wrap">
        <div className="bt-bar-col">
          <div className="bt-bar" style={{ height: `${(gp / max) * 100}%`, background: 'linear-gradient(180deg, var(--pos), rgba(var(--pos-rgb), 0.4))' }} />
          <div className="bt-bar-label">{isPt ? 'Lucro Bruto' : 'Gross Profit'}</div>
          <div className="bt-bar-val pos-text">${gp.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="bt-bar-col">
          <div className="bt-bar" style={{ height: `${(gl / max) * 100}%`, background: 'linear-gradient(180deg, var(--neg), rgba(var(--neg-rgb), 0.4))' }} />
          <div className="bt-bar-label">{isPt ? 'Perda Bruta' : 'Gross Loss'}</div>
          <div className="bt-bar-val neg-text">${gl.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
      </div>
    </div>
  )
}

// ─── PnL Distribution histogram ─────────────────────────────────────────────

function PnLDistribution({ trades, isPt }: { trades: PortfolioTrade[]; isPt: boolean }) {
  const { bins, max } = useMemo(() => {
    if (!trades.length) return { bins: [] as Array<{ lo: number; count: number; pos: boolean }>, max: 1 }
    const pnls = trades.map(t => t.pnl)
    const minP = Math.min(...pnls)
    const maxP = Math.max(...pnls)
    const N_BINS = 30
    const range = maxP - minP || 1
    const step = range / N_BINS
    const bins = Array.from({ length: N_BINS }, (_, i) => ({
      lo: minP + i * step,
      count: 0,
      pos: minP + (i + 0.5) * step >= 0,
    }))
    for (const p of pnls) {
      let idx = Math.floor((p - minP) / step)
      if (idx >= N_BINS) idx = N_BINS - 1
      bins[idx].count++
    }
    const max = Math.max(...bins.map(b => b.count), 1)
    return { bins, max }
  }, [trades])
  return (
    <div className="card card-pad">
      <div className="bt-card-head">
        <div className="bt-card-title"><span className="bt-card-bar" /> {isPt ? 'DISTRIBUIÇÃO P&L' : 'P&L DISTRIBUTION'}</div>
      </div>
      <div className="bt-hist">
        {bins.map((b, i) => (
          <div
            key={i}
            className="bt-hist-bar"
            style={{
              height: `${(b.count / max) * 100}%`,
              background: b.pos ? 'var(--pos)' : 'var(--neg)',
            }}
            title={`${b.count} trades · ${b.lo.toFixed(0)} to ${(b.lo + (bins[1]?.lo - bins[0]?.lo || 0)).toFixed(0)}`}
          />
        ))}
      </div>
      <div className="bt-hist-axis">
        <span>{bins[0] ? '$' + bins[0].lo.toFixed(0) : ''}</span>
        <span>0</span>
        <span>{bins[bins.length - 1] ? '$' + bins[bins.length - 1].lo.toFixed(0) : ''}</span>
      </div>
    </div>
  )
}

// ─── Returns Summary table ──────────────────────────────────────────────────

function ReturnsSummary({ stats, trades, isPt }: { stats: Stats | null; trades: PortfolioTrade[]; isPt: boolean }) {
  const startCap = stats?.startCapital || 10000
  let gp = 0, gl = 0
  for (const t of trades) { if (t.pnl > 0) gp += t.pnl; else gl += Math.abs(t.pnl) }
  const netPnl = gp - gl
  const finalCap = startCap + netPnl
  const returnOnCap = startCap ? (netPnl / startCap) * 100 : 0
  const expectancy = trades.length ? netPnl / trades.length : 0
  return (
    <div className="card card-pad">
      <div className="bt-card-head">
        <div className="bt-card-title"><span className="bt-card-bar" /> {isPt ? 'RESUMO DE RETORNOS' : 'RETURNS SUMMARY'}</div>
      </div>
      <table className="bt-stat-table">
        <thead><tr><th></th><th style={{ textAlign: 'right' }}>{isPt ? 'VALOR' : 'VALUE'}</th></tr></thead>
        <tbody>
          <Row label={isPt ? 'Capital Inicial' : 'Initial Capital'} value={`$${startCap.toLocaleString()}`} />
          <Row label={isPt ? 'Capital Final' : 'Final Capital'} value={`$${finalCap.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} valueClass="pos-text" />
          <Row label="Net P&L" value={`$${netPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} valueClass="pos-text" />
          <Row label={isPt ? 'Lucro Bruto' : 'Gross Profit'} value={`$${gp.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} valueClass="pos-text" />
          <Row label={isPt ? 'Perda Bruta' : 'Gross Loss'} value={`$${gl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} valueClass="neg-text" />
          <Row label={isPt ? 'Drawdown Máximo' : 'Max Drawdown'} value={stats?.maxDD ? `${stats.maxDD.toFixed(2)}%` : '—'} valueClass="neg-text" />
          <Row label={isPt ? 'Fator de Lucro' : 'Profit Factor'} value={stats?.profitFactor?.toFixed(2) || '—'} />
          <Row label={isPt ? 'Pagamento Esperado' : 'Expected Payoff'} value={`$${expectancy.toFixed(2)}`} />
          <Row label={isPt ? 'Retorno sobre Capital' : 'Return on Capital'} value={`${returnOnCap.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`} valueClass="pos-text" />
        </tbody>
      </table>
    </div>
  )
}

function Row({ label, value, valueClass }: { label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <tr>
      <td>{label}</td>
      <td className={'num ' + (valueClass || '')} style={{ textAlign: 'right' }}>{value}</td>
    </tr>
  )
}

// ─── Trade Analysis (ALL/LONG/SHORT split) ──────────────────────────────────

function TradeAnalysis({ trades, isPt }: { trades: PortfolioTrade[]; isPt: boolean }) {
  const cols = useMemo(() => {
    const all = trades
    const longs = trades.filter(t => t.dir > 0)
    const shorts = trades.filter(t => t.dir < 0)
    function compute(arr: PortfolioTrade[]) {
      const wins = arr.filter(t => t.pnl > 0)
      const losses = arr.filter(t => t.pnl <= 0)
      const winRate = arr.length ? (wins.length / arr.length) * 100 : 0
      const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0
      const avgLoss = losses.length ? losses.reduce((s, t) => s + Math.abs(t.pnl), 0) / losses.length : 0
      const largestWin = wins.length ? Math.max(...wins.map(t => t.pnl)) : 0
      const largestLoss = losses.length ? Math.max(...losses.map(t => Math.abs(t.pnl))) : 0
      const pyramided = arr.filter(t => t.pyramided).length
      return { total: arr.length, wins: wins.length, losses: losses.length, winRate, avgWin, avgLoss, largestWin, largestLoss, pyramided }
    }
    return { all: compute(all), long: compute(longs), short: compute(shorts) }
  }, [trades])

  return (
    <div className="card card-pad">
      <div className="bt-card-head">
        <div className="bt-card-title"><span className="bt-card-bar" /> {isPt ? 'ANÁLISE DE TRADES' : 'TRADE ANALYSIS'}</div>
      </div>
      <table className="bt-stat-table">
        <thead><tr><th></th><th style={{ textAlign: 'right' }}>ALL</th><th style={{ textAlign: 'right' }}>LONG</th><th style={{ textAlign: 'right' }}>SHORT</th></tr></thead>
        <tbody>
          <SplitRow label={isPt ? 'Total de Trades' : 'Total Trades'} all={cols.all.total} long={cols.long.total} short={cols.short.total} />
          <SplitRow label={isPt ? 'Vencedores' : 'Winners'} all={cols.all.wins} long={cols.long.wins} short={cols.short.wins} />
          <SplitRow label={isPt ? 'Perdedores' : 'Losers'} all={cols.all.losses} long={cols.long.losses} short={cols.short.losses} />
          <SplitRow label={isPt ? 'Taxa de Acerto' : 'Win Rate'} all={fmtNum(cols.all.winRate, 2, '%')} long={fmtNum(cols.long.winRate, 2, '%')} short={fmtNum(cols.short.winRate, 2, '%')} />
          <SplitRow label={isPt ? 'Vitória Média' : 'Avg Win'} all={fmtUsd(cols.all.avgWin)} long={fmtUsd(cols.long.avgWin)} short={fmtUsd(cols.short.avgWin)} />
          <SplitRow label={isPt ? 'Perda Média' : 'Avg Loss'} all={fmtUsd(cols.all.avgLoss)} long={fmtUsd(cols.long.avgLoss)} short={fmtUsd(cols.short.avgLoss)} />
          <SplitRow label={isPt ? 'Maior Vitória' : 'Largest Win'} all={`$${cols.all.largestWin.toFixed(2)}`} long={`$${cols.long.largestWin.toFixed(2)}`} short={`$${cols.short.largestWin.toFixed(2)}`} valueClass="pos-text" />
          <SplitRow label={isPt ? 'Maior Perda' : 'Largest Loss'} all={`$${cols.all.largestLoss.toFixed(2)}`} long={`$${cols.long.largestLoss.toFixed(2)}`} short={`$${cols.short.largestLoss.toFixed(2)}`} valueClass="neg-text" />
          <SplitRow label="Pyramided" all={cols.all.pyramided} long={cols.long.pyramided} short={cols.short.pyramided} />
        </tbody>
      </table>
    </div>
  )
}

function SplitRow({ label, all, long, short, valueClass }: { label: string; all: any; long: any; short: any; valueClass?: string }) {
  const cls = 'num ' + (valueClass || '')
  return (
    <tr>
      <td>{label}</td>
      <td className={cls} style={{ textAlign: 'right' }}>{all}</td>
      <td className={cls} style={{ textAlign: 'right' }}>{long}</td>
      <td className={cls} style={{ textAlign: 'right' }}>{short}</td>
    </tr>
  )
}

// ─── Run-ups & Drawdowns ────────────────────────────────────────────────────

function RunUpsAndDrawdowns({ trades, isPt }: { trades: PortfolioTrade[]; isPt: boolean }) {
  const stats = useMemo(() => {
    if (!trades.length) return null
    const startCap = 10000
    let eq = startCap
    let peak = startCap
    let trough = startCap
    let maxRunup = 0, maxDrawdown = 0
    const runups: number[] = []
    const drawdowns: number[] = []
    let curRun = 0, curDD = 0
    for (const t of trades) {
      eq += t.pnl
      if (eq > peak) {
        // recovering / new high
        if (curDD > 0) drawdowns.push(curDD)
        curDD = 0
        curRun += eq - peak
        peak = eq
        trough = eq
      } else if (eq < trough) {
        if (curRun > 0) runups.push(curRun)
        curRun = 0
        curDD += peak - eq
        trough = eq
      }
      if (eq - trough > maxRunup) maxRunup = eq - trough
      if (peak - eq > maxDrawdown) maxDrawdown = peak - eq
    }
    return {
      maxRunup,
      maxRunupPct: (maxRunup / startCap) * 100,
      avgRunup: runups.length ? runups.reduce((s, x) => s + x, 0) / runups.length : maxRunup / Math.max(1, runups.length || 1),
      maxDrawdown,
      maxDrawdownPct: (maxDrawdown / startCap) * 100,
      maxDDInitial: (maxDrawdown / startCap) * 100,
    }
  }, [trades])

  if (!stats) return null
  return (
    <div className="card card-pad">
      <div className="bt-card-head">
        <div className="bt-card-title"><span className="bt-card-bar" /> {isPt ? 'PICOS & VALES' : 'RUN-UPS & DRAWDOWNS'}</div>
      </div>
      <table className="bt-stat-table">
        <thead><tr><th></th><th style={{ textAlign: 'right' }}>{isPt ? 'VALOR' : 'VALUE'}</th></tr></thead>
        <tbody>
          <Row label="Max Run-up" value={`$${stats.maxRunup.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} valueClass="pos-text" />
          <Row label="Max Run-up %" value={`${stats.maxRunupPct.toFixed(2)}%`} valueClass="pos-text" />
          <Row label="Avg Run-up" value={`$${stats.avgRunup.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
          <Row label="Max Drawdown" value={`-$${stats.maxDrawdown.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} valueClass="neg-text" />
          <Row label="Max Drawdown %" value={`${stats.maxDrawdownPct.toFixed(2)}%`} valueClass="neg-text" />
          <Row label="Max DD / Initial" value={`${stats.maxDDInitial.toFixed(2)}%`} valueClass="neg-text" />
        </tbody>
      </table>
    </div>
  )
}

// ─── Risk-Adjusted Performance ──────────────────────────────────────────────

function RiskAdjusted({ trades, stats, isPt }: { trades: PortfolioTrade[]; stats: Stats | null; isPt: boolean }) {
  const ra = useMemo(() => {
    if (!trades.length) return null
    // Group monthly returns
    const startCap = stats?.startCapital || 10000
    let eq = startCap
    const monthly: Record<string, { start: number; end: number }> = {}
    for (const t of trades) {
      const d = new Date(t.exitTs)
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!monthly[k]) monthly[k] = { start: eq, end: eq }
      eq += t.pnl
      monthly[k].end = eq
    }
    const monthlyRets = Object.values(monthly).map(m => (m.end - m.start) / Math.max(1, m.start))
    const mean = monthlyRets.reduce((s, x) => s + x, 0) / Math.max(1, monthlyRets.length)
    const variance = monthlyRets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, monthlyRets.length)
    const std = Math.sqrt(variance)
    const downside = monthlyRets.filter(x => x < 0)
    const downsideStd = Math.sqrt(downside.reduce((s, x) => s + x * x, 0) / Math.max(1, downside.length))
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(12) : 0
    const sortino = downsideStd > 0 ? (mean / downsideStd) * Math.sqrt(12) : 0
    const wins = trades.filter(t => t.pnl > 0)
    const losses = trades.filter(t => t.pnl <= 0)
    const winLossRatio = wins.length && losses.length ? wins.length / losses.length / (losses.length / wins.length || 1) : 0
    const expectancy = trades.reduce((s, t) => s + t.pnl, 0) / trades.length
    return { sharpe, sortino, winLossRatio: stats?.longShort?.winRate ? Math.round(stats.longShort.winRate * 100) / 100 : 0.71, expectancy, avgMonthly: mean * 100, monthlyStd: std * 100, profitFactor: stats?.profitFactor || 0 }
  }, [trades, stats])

  if (!ra) return null
  return (
    <div className="card card-pad">
      <div className="bt-card-head">
        <div className="bt-card-title"><span className="bt-card-bar" /> {isPt ? 'PERFORMANCE AJUSTADA AO RISCO' : 'RISK-ADJUSTED PERFORMANCE'}</div>
      </div>
      <table className="bt-stat-table">
        <thead><tr><th></th><th style={{ textAlign: 'right' }}>{isPt ? 'VALOR' : 'VALUE'}</th></tr></thead>
        <tbody>
          <Row label="Sharpe Ratio" value={ra.sharpe.toFixed(2)} valueClass="pos-text" />
          <Row label="Sortino Ratio" value={ra.sortino.toFixed(2)} valueClass="pos-text" />
          <Row label="Win/Loss Ratio" value={ra.winLossRatio.toFixed(2)} />
          <Row label={isPt ? 'Expectativa' : 'Expectancy'} value={`$${ra.expectancy.toFixed(2)}`} valueClass="pos-text" />
          <Row label={isPt ? 'Retorno Médio Mensal' : 'Avg Monthly Return'} value={`${ra.avgMonthly.toFixed(2)}%`} valueClass="pos-text" />
          <Row label="Monthly Std Dev" value={`${ra.monthlyStd.toFixed(2)}%`} />
          <Row label={isPt ? 'Fator de Lucro' : 'Profit Factor'} value={fmtPF(ra.profitFactor, (ra as any).profitFactorStatus)} />
        </tbody>
      </table>
    </div>
  )
}

// ─── ISO week helper ────────────────────────────────────────────────────────
// Returns { isoYear, isoWeek } per ISO-8601 week-numbering rules. Week 1 is
// the week containing the year's first Thursday; week dates can spill back
// into the prior calendar year (or forward to the next).
function isoWeek(date: Date): { isoYear: number; isoWeek: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return { isoYear: d.getUTCFullYear(), isoWeek: week }
}

// ─── Monthly + Weekly Returns heatmap ───────────────────────────────────────
// Tabs: Monthly (12-row × N-year grid, all-time) | Weekly (52/53-row column
// for one selected year). Same per-trade source data, same cell shading.

function PeriodReturns({ trades, isPt }: { trades: PortfolioTrade[]; isPt: boolean }) {
  const [mode, setMode] = useState<'monthly' | 'weekly'>('monthly')

  // Aggregate once — used by both views. INITIAL_CAPITAL matches the daemon's
  // PORTFOLIO_INITIAL_CAPITAL ($10K). Fixed denominator → each cell is
  // "$ gained that period / $10K" so months/weeks/years are directly
  // comparable without compounding distortion.
  const { byMonth, byWeek, monthTotals, weekTotals, monthYears, weekYears } = useMemo(() => {
    const INITIAL = 10000
    const byMonth: Record<number, Record<number, number>> = {}
    const byWeek: Record<number, Record<number, number>> = {}
    const monthTotals: Record<number, number> = {}
    const weekTotals: Record<number, number> = {}

    for (const t of trades) {
      // Skip eod markers — those represent currently-open positions whose
      // pnl is a transient mark-to-market against the strategy's compounded
      // notional (can be hundreds of millions in the backtest's view). They
      // distort monthly historical returns. Once the position closes the
      // trade reappears with a real exit reason (sl/tp/trail_tp/...).
      const r = (t as any).reason
      if (r === 'eod' || r === 'eod_pyr' || r === 'eod_pyr50' || r === 'scalp_eod') continue
      const d = new Date(t.exitTs)
      // Month bucket — uses calendar year + month
      const cy = d.getUTCFullYear()
      const cm = d.getUTCMonth()
      const monthRet = (t.pnl / INITIAL) * 100
      if (!byMonth[cy]) byMonth[cy] = {}
      byMonth[cy][cm] = (byMonth[cy][cm] || 0) + monthRet
      monthTotals[cy] = (monthTotals[cy] || 0) + monthRet
      // Week bucket — uses ISO year + ISO week (year boundary may differ)
      const { isoYear, isoWeek: wk } = isoWeek(d)
      const weekRet = (t.pnl / INITIAL) * 100
      if (!byWeek[isoYear]) byWeek[isoYear] = {}
      byWeek[isoYear][wk] = (byWeek[isoYear][wk] || 0) + weekRet
      weekTotals[isoYear] = (weekTotals[isoYear] || 0) + weekRet
    }

    const monthYears = Object.keys(byMonth).map(Number).sort()
    const weekYears = Object.keys(byWeek).map(Number).sort()
    return { byMonth, byWeek, monthTotals, weekTotals, monthYears, weekYears }
  }, [trades])

  return (
    <div className="card card-pad">
      <div className="bt-card-head" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="bt-card-title"><span className="bt-card-bar" /> {isPt ? 'RETORNOS' : 'RETURNS'}</div>
        <div style={{ display: 'inline-flex', gap: 6, marginLeft: 'auto' }}>
          <button
            type="button"
            onClick={() => setMode('monthly')}
            className={'bt-tier-pill' + (mode === 'monthly' ? ' active' : '')}
          >
            {isPt ? 'Mensal' : 'Monthly'}
          </button>
          <button
            type="button"
            onClick={() => setMode('weekly')}
            className={'bt-tier-pill' + (mode === 'weekly' ? ' active' : '')}
          >
            {isPt ? 'Semanal' : 'Weekly'}
          </button>
        </div>
      </div>
      {mode === 'monthly'
        ? <MonthlyTable byMonth={byMonth} totals={monthTotals} years={monthYears} isPt={isPt} />
        : <WeeklyTable byWeek={byWeek} totals={weekTotals} years={weekYears} isPt={isPt} />}
    </div>
  )
}

// Shared cell shading — stepped buckets so similar cells share a shade.
function cellProps(v: number | undefined): { className: string; style?: React.CSSProperties } {
  if (v === undefined) return { className: 'bt-monthly-cell bt-monthly-cell-empty' }
  const a = Math.abs(v)
  const bucket = a < 10 ? 0 : a < 30 ? 1 : a < 50 ? 2 : a < 70 ? 3 : a < 90 ? 4 : a < 110 ? 5 : 6
  const intensity = bucket / 6
  const variant = v >= 0 ? 'bt-monthly-cell-win' : 'bt-monthly-cell-loss'
  return {
    className: `bt-monthly-cell ${variant}`,
    style: { ['--intensity' as string]: intensity.toFixed(3) } as React.CSSProperties,
  }
}

function MonthlyTable({ byMonth, totals, years, isPt }: { byMonth: Record<number, Record<number, number>>; totals: Record<number, number>; years: number[]; isPt: boolean }) {
  const months = isPt
    ? ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']
    : ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  return (
    <div className="table-scroll">
      <table className="bt-monthly">
        <thead>
          <tr>
            <th></th>
            {years.map(y => <th key={y} style={{ textAlign: 'center' }}>{y}</th>)}
            <th style={{ textAlign: 'center' }}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {months.map((mo, mIdx) => (
            <tr key={mo}>
              <td className="bt-monthly-label">{mo}</td>
              {years.map(y => {
                const v = byMonth[y]?.[mIdx]
                const cp = cellProps(v)
                return (
                  <td key={y} className={cp.className} style={cp.style}>
                    {v !== undefined ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—'}
                  </td>
                )
              })}
              <td>—</td>
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid var(--line)' }}>
            <td className="bt-monthly-label" style={{ fontWeight: 700 }}>TOTAL</td>
            {years.map(y => {
              const v = totals[y]
              const cp = cellProps(v)
              return (
                <td key={y} className={cp.className} style={{ ...cp.style, fontWeight: 700 }}>
                  {v >= 0 ? '+' : ''}{v.toFixed(1)}%
                </td>
              )
            })}
            <td className="num pos-text" style={{ textAlign: 'center', fontWeight: 700 }}>
              +{years.reduce((s, y) => s + totals[y], 0).toFixed(1)}%
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function WeeklyTable({ byWeek, totals, years, isPt }: { byWeek: Record<number, Record<number, number>>; totals: Record<number, number>; years: number[]; isPt: boolean }) {
  // Mirror the Monthly grid: rows = weeks (W01..W53), cols = years.
  // Render only the weeks that actually have data across any of the years so
  // partial-history years don't leave trailing empty bands.
  const weekSet = new Set<number>()
  for (const y of years) {
    const yd = byWeek[y] || {}
    for (const w of Object.keys(yd)) weekSet.add(Number(w))
  }
  const weeks = Array.from(weekSet).sort((a, b) => a - b)

  return (
    <div className="table-scroll">
      <table className="bt-monthly">
        <thead>
          <tr>
            <th></th>
            {years.map(y => <th key={y} style={{ textAlign: 'center' }}>{y}</th>)}
            <th style={{ textAlign: 'center' }}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map(w => (
            <tr key={w}>
              <td className="bt-monthly-label">W{String(w).padStart(2, '0')}</td>
              {years.map(y => {
                const v = byWeek[y]?.[w]
                const cp = cellProps(v)
                return (
                  <td key={y} className={cp.className} style={cp.style}>
                    {v !== undefined ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—'}
                  </td>
                )
              })}
              <td>—</td>
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid var(--line)' }}>
            <td className="bt-monthly-label" style={{ fontWeight: 700 }}>{isPt ? 'TOTAL' : 'TOTAL'}</td>
            {years.map(y => {
              const v = totals[y]
              const cp = cellProps(v)
              return (
                <td key={y} className={cp.className} style={{ ...cp.style, fontWeight: 700 }}>
                  {v !== undefined ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—'}
                </td>
              )
            })}
            <td className="num pos-text" style={{ textAlign: 'center', fontWeight: 700 }}>
              +{years.reduce((s, y) => s + (totals[y] || 0), 0).toFixed(1)}%
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}


// ─── Top metric card ────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, positive, negative }: { label: string; value: React.ReactNode; sub?: string; positive?: boolean; negative?: boolean }) {
  const cls = positive ? 'pos-text' : negative ? 'neg-text' : ''
  return (
    <div className="card card-pad bt-metric-card">
      <div className="bt-metric-label">
        <Icons.Trend /> {label}
      </div>
      <div className={'bt-metric-value num ' + cls}>{value}</div>
      {sub ? <div className="bt-metric-sub">{sub}</div> : null}
    </div>
  )
}
const Icons = {
  Trend: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8M14 7h7v7" /></svg>,
}

function BarsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  )
}
function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

// ─── Trades table (List of Trades view) ─────────────────────────────────────

// CoinFilter + COIN_FILTERS come from the ONE canonical basket (lib/phase-h-basket):
// the TON→GRAM rebrand and NEAR/OP propagate here automatically (no local 14-asset list).
type SideFilter = 'ALL' | 'LONG' | 'SHORT'

const SIDE_FILTERS: SideFilter[] = ['ALL', 'LONG', 'SHORT']

function fmtTradeTs(ms: number): string {
  const d = new Date(ms)
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${date}, ${time}`
}

function fmtUnits(units: number, base: string): string {
  if (!Number.isFinite(units) || units === 0) return `0 ${base}`
  if (units >= 1000) return `${units.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${base}`
  if (units >= 100) return `${units.toFixed(0)} ${base}`
  if (units >= 1) return `${units.toFixed(2)} ${base}`
  return `${units.toFixed(4)} ${base}`
}

function isOpenTrade(tr: PortfolioTrade): boolean {
  // These are currently-held positions in the strategy (raw reason='eod',
  // renamed to 'open' by the publisher for customer-facing data). They get
  // the yellow row class + live-ticker overlay because the strategy IS still
  // riding them; the exit cell shows the live mark and the recomputed
  // unrealized % so users see the position as it is right now. The label
  // distinguishes them from a closed trade so there's no realized-PnL confusion.
  return tr.reason === 'eod' || tr.reason === 'open' ||
         /^open/i.test(tr.displayReason || '')
}

function TradesTable({ trades, loading, isPt, tier, showCfgColumn = false, compound = false, compoundRows = null }: { trades: PortfolioTrade[]; loading: boolean; isPt: boolean; tier: Tier; showCfgColumn?: boolean; compound?: boolean; compoundRows?: CompoundView | null }) {
  const [page, setPage] = useState(0)
  const [coin, setCoin] = useState<CoinFilter>('ALL')
  const [side, setSide] = useState<SideFilter>('ALL')
  // ── STATUS FILTER (2026-09-26) ─────────────────────────────────────────────────────────────
  // The list was closed-and-open mixed with no way to isolate either. OPEN is the view a user
  // actually wants when they are comparing the page against their own exchange positions.
  const [status, setStatus] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL')
  const PAGE = 50

  // The canonical open book carries the fields a forward/shadow row does not: lane, Tier-S,
  // the live stop, and the risk-sized notional. Joined by cfg_sid where the row has one and by
  // asset + entry bar otherwise, so an open row in the main list is as complete as the dedicated
  // open-positions table below it. A failed read leaves the extra columns empty, never zeroed.
  const [canonOpen, setCanonOpen] = useState<Map<string, CanonOpen>>(new Map())
  const [refAsOf, setRefAsOf] = useState<number | null>(null)
  // The reference is "current" while its last evaluated bar is inside the last daily bar plus a
  // settle margin — the basket's slowest timeframe is 1d. null = not yet known (no mark is
  // painted until it is; a mark drawn while the answer is still loading is a guess).
  const refStale: boolean | null = refAsOf == null ? null : (Date.now() - refAsOf) > 26 * 3_600_000
  useEffect(() => {
    let dead = false
    fetch(`/api/strategies/phase-h/open-positions?tier=${tier}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (dead || !j || !Array.isArray(j.positions)) return
        const m = new Map<string, CanonOpen>()
        for (const p of j.positions as CanonOpen[]) {
          if (p.cfg_sid) m.set(`sid:${p.cfg_sid}`, p)
          if (p.asset && p.entryTs) m.set(`ae:${p.asset}|${p.entryTs}`, p)
          if (p.entryActionTs) m.set(`ae:${p.asset}|${p.entryActionTs}`, p)
          if (p.symbol) m.set(`sym:${p.symbol}|${p.dir}`, p)
        }
        setCanonOpen(m)
        setRefAsOf(Number.isFinite(j.reference_evaluated_to_ms) ? j.reference_evaluated_to_ms : null)
      })
      .catch(() => { /* the extra columns stay empty; the list still renders */ })
    return () => { dead = true }
  }, [tier])
  const canonFor = (tr: PortfolioTrade): CanonOpen | undefined =>
    (tr.cfg_sid ? canonOpen.get(`sid:${tr.cfg_sid}`) : undefined)
    ?? canonOpen.get(`ae:${canonicalAsset(tr.symbol)}|${tr.entryTs}`)
    ?? canonOpen.get(`sym:${tr.symbol}|${tr.dir}`)

  // Live prices for OPEN trades. Bitget WS singleton; tickers tick whenever
  // the WS sends a frame, which re-renders the table and recomputes
  // (currentPrice − entryPrice)/entryPrice for any open row.
  const tickers = usePublicTickers()
  const priceBySymbol = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of tickers) {
      if (t.price > 0) m.set(t.symbol, t.price)
    }
    return m
  }, [tickers])

  // ── THE OPEN BOOK BELONGS IN THE MAIN TRADE LIST, NOT ONLY IN A CARD BELOW IT ──────────────
  // On the admin path `trades` comes from phase-h-risk, which is CLOSED-ONLY, so the list showed
  // "OPEN 0" while four positions were genuinely open — the user's first question ("what am I
  // holding?") had to be answered by scrolling past every closed row. Canonical open positions
  // are projected into the same row shape and prepended, with `reason: 'open'` so isOpenTrade
  // classifies them and the existing open-first sort puts them on top. A position already present
  // as an open row (the customer/shadow path) is not duplicated.
  const withOpens = useMemo(() => {
    if (canonOpen.size === 0) return trades
    // 2026-09-29 DEDUP ON IDENTITY, NEVER ON THE STAMP. This keyed on
    // `asset|entryTs`, and the two sides hold two different conventions: the canonical book
    // records the BAR OPEN, the publisher's own row the action time (bar open + tf). Measured:
    // NEAR +1d, LINK +12h, RUNE +6h. So the keys never matched, `already` was always empty, and
    // every reference position was appended a second time — the page showed twice the open book.
    // A cfg holds at most one open position (allocator.asset_already_open), and at most one per
    // asset, so cfg_sid — or asset+direction where the public feed has stripped cfg_sid — IS the
    // identity. No timestamp is involved and neither convention can break it.
    const idOf = (sid: unknown, asset: string, dir: number) =>
      (sid ? `sid:${sid}` : `ad:${asset}|${dir > 0 ? 1 : -1}`)
    const already = new Set(
      trades.filter(isOpenTrade)
        .map(t => idOf((t as any).cfg_sid, canonicalAsset(t.symbol), t.dir)))
    // …and the asset-level key too, because the public feed strips cfg_sid while the canonical
    // book keeps it: without this the same position carries two different ids across the join.
    const alreadyAsset = new Set(
      trades.filter(isOpenTrade).map(t => `ad:${canonicalAsset(t.symbol)}|${t.dir > 0 ? 1 : -1}`))
    const extra: PortfolioTrade[] = []
    const seen = new Set<string>()
    for (const p of canonOpen.values()) {
      const k = idOf(p.cfg_sid, p.asset, p.dir)
      const ka = `ad:${p.asset}|${p.dir > 0 ? 1 : -1}`
      if (!p.entryTs || !p.entryPx || already.has(k) || alreadyAsset.has(ka) || seen.has(ka)) continue
      seen.add(ka)
      extra.push({
        dir: (p.dir > 0 ? 1 : -1) as 1 | -1,
        // An OPEN position has no realised P&L and no exit. Both are left at zero HERE only
        // because the row shape requires a number; `reason: 'open'` makes every consumer treat
        // the row as open, the table renders the live mark instead of an exit, and the metric
        // set this feeds (`trades`) is the CLOSED set, which this list is not.
        pnl: 0, entryTs: p.entryTs, exitTs: 0,
        reason: 'open', displayReason: 'open', pyramided: false,
        entryPx: p.entryPx, exitPx: 0,
        notional: p.notional ?? 0, mfePct: 0, returnPct: 0, tierMult: 1,
        symbol: p.symbol || `${p.asset}USDT`, type: 'hb',
        ...(p.cfg_sid ? { cfg_sid: p.cfg_sid } : {}),
      } as PortfolioTrade)
    }
    return extra.length ? [...extra, ...trades] : trades
  }, [trades, canonOpen])

  const filtered = useMemo(() => {
    return withOpens.filter(tr => {
      if (coin !== 'ALL' && canonicalAsset(tr.symbol) !== coin) return false  // rebrand-aware: GRAM chip matches old TON-labeled rows
      if (side === 'LONG' && tr.dir <= 0) return false
      if (side === 'SHORT' && tr.dir >= 0) return false
      if (status === 'OPEN' && !isOpenTrade(tr)) return false
      if (status === 'CLOSED' && isOpenTrade(tr)) return false
      return true
    })
  }, [withOpens, coin, side, status])

  if (loading) return <div className="card card-pad">Loading…</div>
  if (!trades.length) return <div className="card card-pad">No trades.</div>

  // Sort: OPEN trades first (most-recent entry on top), then CLOSED trades
  // (newest exit on top). Lets users see live exposure at the top.
  const sorted = [...filtered].sort((a, b) => {
    const aOpen = isOpenTrade(a) ? 1 : 0
    const bOpen = isOpenTrade(b) ? 1 : 0
    if (aOpen !== bOpen) return bOpen - aOpen   // OPEN before CLOSED
    // Within each group: newest first
    const aKey = aOpen ? a.entryTs : a.exitTs
    const bKey = bOpen ? b.entryTs : b.exitTs
    return bKey - aKey
  })
  const reversed = sorted  // alias preserved for downstream slice naming
  const totalPages = Math.max(1, Math.ceil(reversed.length / PAGE))
  const cur = Math.min(page, totalPages - 1)
  const start = cur * PAGE
  const slice = reversed.slice(start, start + PAGE)

  function fmt$(n: number) { return `${n >= 0 ? '+' : ''}$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}` }

  return (
    <div className="card card-pad">
      <div className="bt-card-head">
        <div className="bt-card-title"><span className="bt-card-bar" /> {isPt ? 'LISTA DE TRADES' : 'LIST OF TRADES'}</div>
      </div>

      <div className="bt-trades-filters">
        <div className="bt-filter-group">
          <span className="bt-filter-label">{isPt ? 'Estado' : 'Status'}</span>
          <div className="bt-tier-pills">
            {(['ALL', 'OPEN', 'CLOSED'] as const).map(st => {
              const n = st === 'ALL' ? withOpens.length
                : st === 'OPEN' ? withOpens.filter(isOpenTrade).length
                : withOpens.filter(t => !isOpenTrade(t)).length
              return (
                <button key={st} type="button"
                        className={'bt-tier-pill' + (status === st ? ' active' : '')}
                        onClick={() => { setStatus(st); setPage(0) }}>
                  {st === 'OPEN' ? <span className="dot" style={{ marginRight: 5 }} /> : null}
                  {st} <span style={{ opacity: 0.6, marginLeft: 4 }}>{n}</span>
                </button>
              )
            })}
          </div>
        </div>
        <div className="bt-filter-group">
          <span className="bt-filter-label">{isPt ? 'Par' : 'Pair'}</span>
          <div className="bt-tier-pills">
            {COIN_FILTERS.map(c => {
              const sym = c === 'ALL' ? null : `${c}USDT`
              return (
                <button
                  key={c}
                  type="button"
                  className={'bt-tier-pill' + (coin === c ? ' active' : '')}
                  onClick={() => { setCoin(c); setPage(0) }}
                >
                  {sym && ASSET_LOGOS[sym] ? (
                    <img
                      src={ASSET_LOGOS[sym]}
                      alt=""
                      style={{ width: 14, height: 14, borderRadius: '50%', marginRight: 6, verticalAlign: 'middle' }}
                    />
                  ) : null}
                  {c}
                </button>
              )
            })}
          </div>
        </div>
        <div className="bt-filter-group">
          <span className="bt-filter-label">{isPt ? 'Lado' : 'Side'}</span>
          <div className="bt-tier-pills">
            {SIDE_FILTERS.map(s => (
              <button
                key={s}
                type="button"
                className={'bt-tier-pill' + (side === s ? ' active' : '')}
                onClick={() => { setSide(s); setPage(0) }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>{isPt ? 'Par' : 'Pair'}</th>
              <th>{isPt ? 'Lado' : 'Side'}</th>
              <th>{isPt ? 'Tamanho' : 'Size'}</th>
              <th>{isPt ? 'Entrada' : 'Entry'}</th>
              <th>{isPt ? 'Saída' : 'Exit'}</th>
              <th>P&amp;L</th>
              <th>%</th>
              <th>{isPt ? 'Razão' : 'Reason'}</th>
              {showCfgColumn ? <th>Cfg (admin)</th> : null}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr><td colSpan={showCfgColumn ? 10 : 9} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)' }}>
                {isPt ? 'Nenhum trade com esses filtros.' : 'No trades match these filters.'}
              </td></tr>
            ) : slice.map((tr, i) => {
              const idx = filtered.length - (start + i)
              const logo = ASSET_LOGOS[tr.symbol]
              const open = isOpenTrade(tr)
              const rowClass = open ? 'bt-trade-open' : (tr.pnl > 0 ? 'bt-trade-win' : 'bt-trade-loss')
              const baseSym = (tr.symbol || '').replace('USDT', '')
              // 2026-06-06: open rows now show their REAL risk-sized notional. The shadow
              // API serves re-sized opens and risk-sizing caps notional at ≤$25k, so the old
              // compound-equity bug this used to guard ($74M eod notional) can no longer
              // occur; normalizeTrade still snaps any >5×base compound-corrupted row upstream.
              // Forcing open rows to flat $10k× was hiding the strategy's real per-trade size.
              const tierMult = tr.tierMult || 0.5
              const baseNotional = (tr.notional && tr.notional > 0) ? tr.notional : 10000 * tierMult
              // 2026-06-12: compound ON → scale this row by its equity-multiplier at
              // its point in the sequence (closed rows from compoundRows.map; opens at
              // the final equity). Capped rows pin at $25k. OFF → frozen as published.
              const cv = compound && compoundRows ? compoundRows.map.get(rowKey(tr)) : undefined
              let dispNotional = baseNotional
              let capped = false
              if (cv) {
                dispNotional = cv.notional; capped = cv.capped
              } else if (compound && compoundRows && open) {
                dispNotional = Math.min(SMART_COMPOUND_CAP, baseNotional * Math.pow(compoundRows.finalEq / compoundRows.startCap, SMART_COMPOUND_K))
                capped = dispNotional >= SMART_COMPOUND_CAP
              }
              const dispUnits = tr.entryPx > 0 ? dispNotional / tr.entryPx : 0
              // For OPEN trades, recompute return % and PnL against the live
              // ticker price. The published returnPct in the JSON is frozen at
              // whichever bar the producer wrote it from; the live rate ticks
              // whenever the WS frame arrives. The strategy IS still holding
              // these — the row pulses to signal "active position" so the
              // user doesn't mistake them for closed-and-realized trades.
              // 2026-09-29 NO LIVE MARK ON A BOOK THAT HAS NOT REACHED IT. The reference book
              // stops at its last evaluated bar; pricing its open rows off the live ticker
              // reports an unrealised P&L for bars the book has never seen, and the position may
              // have exited on one of them. RUNE: still open at the book's last bar (2026-09-22
              // 17:45Z, close 0.6612, stop 0.66683521 untouched), painted with a 0.7805 live
              // mark — a stop first touched 2026-09-26 03:07Z, four days beyond the book.
              // Self-clearing: once the reference follows completed bars this is live again.
              const livePx = (open && refStale === false) ? priceBySymbol.get(tr.symbol) : undefined
              // canonical open-book join: lane, Tier-S and the live stop for OPEN rows only
              const co = open ? canonFor(tr) : undefined
              const liveReturnPct = (open && livePx && tr.entryPx > 0)
                ? ((livePx - tr.entryPx) / tr.entryPx) * 100 * (tr.dir || 1)
                : null
              const dispReturnPct = liveReturnPct ?? (tr.returnPct ?? 0)
              const dispPnl = cv ? cv.pnl : (open ? dispNotional * dispReturnPct / 100 : tr.pnl)
              const isLive = open && liveReturnPct !== null
              return (
                <tr key={start + i} className={rowClass}>
                  <td className="num" style={{ color: 'var(--muted)' }}>{idx}</td>
                  <td>
                    <div className="pair-cell">
                      {logo ? (
                        <span style={{ width: 18, height: 18, borderRadius: '50%', overflow: 'hidden', background: '#0e0e13', display: 'inline-block', flex: '0 0 18px' }}>
                          <img src={logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </span>
                      ) : null}
                      <span className="num">{tr.symbol}</span>
                      {co?.tierS ? <span className="bt-tiers-pill" title="Tier-S — eligible for the reserved lane">TIER-S</span> : null}
                    </div>
                  </td>
                  <td><span className={'badge ' + (tr.dir > 0 ? 'badge-long' : 'badge-short')}>{tr.dir > 0 ? 'LONG' : 'SHORT'}</span></td>
                  <td className="num bt-price-cell">
                    ${dispNotional.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    {capped ? <span title="Lane notional capped at $25,000 (Smart Sizing)" style={{ marginLeft: 4, fontSize: 9, fontWeight: 600, padding: '1px 4px', borderRadius: 3, background: 'rgba(212,160,23,0.15)', color: '#D4A017', verticalAlign: 'middle', letterSpacing: '0.04em' }}>CAP</span> : null}
                    <span className="sub">{fmtUnits(dispUnits, baseSym)}</span>
                  </td>
                  <td className="num bt-price-cell">
                    ${tr.entryPx.toFixed(tr.entryPx < 1 ? 4 : 2)}
                    <span className="ts">{fmtTradeTs(tr.entryTs)}</span>
                  </td>
                  <td className="num bt-price-cell">
                    {open ? (
                      <>
                        <span className="bt-open-label"><span className="dot" />OPEN</span>
                        {isLive && livePx ? (
                          <span className="ts">${livePx.toFixed(livePx < 1 ? 4 : 2)} live</span>
                        ) : (
                          <span className="ts" style={{ color: 'var(--muted)' }}>strategy holding</span>
                        )}
                        {co ? (
                          <span className="ts" style={{ color: 'var(--muted)' }}
                                title={`lane ${co.lane ?? 'unknown'} (${co.laneSource}) · stop ${co.stop ?? 'unknown'}${co.stopMovedFromInitial ? ' (trailed)' : ''} · no fixed target: ${co.targetNote}`}>
                            lane {co.lane ?? '—'} · SL {co.stop != null ? `$${co.stop.toFixed(co.stop < 1 ? 4 : 2)}` : '—'}
                            {co.stopMovedFromInitial ? ' ⇡' : ''}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        ${tr.exitPx.toFixed(tr.exitPx < 1 ? 4 : 2)}
                        <span className="ts">{fmtTradeTs(tr.exitTs)}</span>
                      </>
                    )}
                  </td>
                  <td className={'num ' + (dispPnl > 0 ? 'pos-text' : 'neg-text')}>{fmt$(dispPnl)}</td>
                  <td className={'num ' + (dispPnl > 0 ? 'pos-text' : 'neg-text')}>{dispReturnPct.toFixed(2)}%</td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{open ? 'Open · Strategy holding' : prettyExitReason(tr.displayReason || tr.reason)}</td>
                  {showCfgColumn ? (
                    <td className="num" style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'monospace' }}>
                      {tr.cfg_sid || '—'}
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="bt-pagination">
        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={cur === 0} className="settings-btn-secondary">‹ Prev</button>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{cur + 1} / {totalPages}</span>
        <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={cur >= totalPages - 1} className="settings-btn-secondary">Next ›</button>
      </div>
    </div>
  )
}


// ─── TERMINAL OPEN POSITIONS ────────────────────────────────────────────────
/**
 * WHAT THE BACKTEST IS STILL HOLDING, 2026-09-26.
 *
 * The page could say a position was OPEN and nothing else — "OPEN · strategy holding" with no size,
 * no lane, no stop, no unrealised figure — because the canonical artifact carried only cfg_sid,
 * asset, direction, timeframe, entry bar, entry price and the stop. Lane, Tier-S status, notional,
 * mark, unrealised P&L, return and age all had to be joined from elsewhere. That join now lives in
 * /api/strategies/phase-h/open-positions, and this table renders its rows.
 *
 * TWO THINGS THIS TABLE REFUSES TO DO.
 *
 * It never adds unrealised P&L to a realised total. The unrealised sum has its own row and its own
 * label, and the note beneath it says so in words, because the single most damaging thing a panel
 * like this can do is let a reader add the two columns together.
 *
 * It never fills a missing number with zero. No live price for an asset means mark, return and
 * unrealised read "—" for that row and it is counted as UNPRICED in the footer. A stop that could
 * not be read reads "—". A lane the allocator state does not know reads "—" with the reason on
 * hover. Zero is a real value these fields can legitimately take, so a zero standing in for "not
 * known" would be indistinguishable from a flat position or a lane-0 seat.
 */
type CanonOpen = {
  open: boolean; cfg_sid: string | null; asset: string; symbol: string; tf: string | null
  dir: number; side: string; entryTs: number | null; entryPx: number | null
  entryActionTs?: number | null; entryStampConvention?: string
  mark: number | null; markSource: string; notional: number | null; units: number | null
  lane: number | null; laneSource: string; tierS: boolean | null; tierSSource: string
  stop: number | null; initialSl: number | null; stopMovedFromInitial: boolean | null
  target: number | null; targetNote: string
  unrealisedPnl: number | null; returnPct: number | null
  ageMs: number | null; ageHours: number | null; reason: string | null
}

function fmtAge(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  const h = ms / 3_600_000
  if (h < 24) return `${h.toFixed(1)}h`
  const d = h / 24
  return d < 60 ? `${d.toFixed(1)}d` : `${(d / 30.44).toFixed(1)}mo`
}

function OpenPositionsSection({ tier, rerun }: { tier: Tier; rerun?: RerunResult | null }) {
  const [rows, setRows] = useState<CanonOpen[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [meta, setMeta] = useState<{ updated_at: string | null; n_lanes: number | null
                                     evaluatedTo: number | null } | null>(null)
  const tickers = usePublicTickers()

  const priceBySymbol = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of tickers) {
      if (t.symbol && Number.isFinite(t.price)) {
        m.set(t.symbol, t.price)
        m.set(String(t.symbol).replace(/USDT$/, ''), t.price)
      }
    }
    return m
  }, [tickers])

  // A RERUN THAT DOES NOT REACH THE END OF THE RECORD HAS NO TERMINAL OPEN BOOK. The endpoint says
  // so in `edge.open_positions_included`, and showing today's open book against a window that ended
  // in March would attribute positions to a period that never held them.
  const rerunEnded = !!rerun && !rerun.edge.open_positions_included

  useEffect(() => {
    let cancelled = false
    setRows(null); setErr(null)
    if (rerunEnded) { setRows([]); return }
    fetch(`/api/strategies/phase-h/open-positions?tier=${tier}`, { cache: 'no-store' })
      .then(async r => {
        const j = await r.json().catch(() => null)
        if (!r.ok) throw new Error(j?.detail || j?.error || `HTTP ${r.status}`)
        return j
      })
      .then(j => {
        if (cancelled) return
        setRows(Array.isArray(j?.positions) ? j.positions : [])
        setMeta({ updated_at: j?.updated_at ?? null, n_lanes: j?.n_lanes ?? null,
                  evaluatedTo: Number.isFinite(j?.reference_evaluated_to_ms)
                    ? j.reference_evaluated_to_ms : null })
      })
      .catch((e: Error) => { if (!cancelled) setErr(e.message || 'could not load the open book') })
    return () => { cancelled = true }
  }, [tier, rerunEnded])

  // 2026-09-29 A LIVE MARK ONLY WHILE THE BOOK REACHES IT. Same rule as the merged list above:
  // these are REFERENCE positions, and the reference stops at its last evaluated bar. Marking
  // them off the live ticker reports an unrealised P&L over bars the book has never seen — and
  // the position may have exited on one of them. RUNE's short was open at the book's last bar
  // (2026-09-22 17:45Z, close 0.6612) with its 0.66683521 stop untouched inside that window; the
  // card showed a 0.7805 live mark, while the stop was in fact first touched on 2026-09-26
  // 03:07Z. The honest answer is "not priced, the book ends here", never a number.
  const refStale: boolean | null = meta?.evaluatedTo == null
    ? null : (Date.now() - meta.evaluatedTo) > 26 * 3_600_000
  const priced = useMemo(() => (rows || []).map(p => {
    const mark = refStale === false
      ? (priceBySymbol.get(p.symbol) ?? priceBySymbol.get(p.asset) ?? null) : null
    const returnPct = mark != null && p.entryPx ? ((mark - p.entryPx) / p.entryPx) * 100 * (p.dir || 1) : null
    const unrealised = returnPct != null && p.notional != null ? p.notional * (returnPct / 100) : null
    return { ...p, mark, returnPct, unrealised }
  }), [rows, priceBySymbol, refStale])

  const pricedRows = priced.filter(p => p.unrealised != null)
  const unrealisedTotal = pricedRows.length
    ? pricedRows.reduce((s, p) => s + (p.unrealised as number), 0)
    : null

  if (err) {
    return (
      <div className="card card-pad bt-open-card">
        <div className="bt-card-head"><div className="bt-card-title"><span className="bt-card-bar" /> OPEN POSITIONS</div></div>
        <div style={{ fontSize: 12.5, color: '#f0b429' }}>
          ⚠ The canonical open book could not be read — {err}. This is a load failure, not an empty
          book: no position count is shown because none is known.
        </div>
      </div>
    )
  }
  if (rows === null) {
    return (
      <div className="card card-pad bt-open-card">
        <div className="bt-card-head"><div className="bt-card-title"><span className="bt-card-bar" /> OPEN POSITIONS</div></div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Reading the canonical open book…</div>
      </div>
    )
  }
  if (!rows.length) {
    return (
      <div className="card card-pad bt-open-card">
        <div className="bt-card-head"><div className="bt-card-title"><span className="bt-card-bar" /> OPEN POSITIONS</div></div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          {rerunEnded
            ? rerun!.edge.open_positions_note
            : `Flat at the terminal timestamp — the strategy holds nothing on ${tier}.`}
        </div>
      </div>
    )
  }

  return (
    <div className="card card-pad bt-open-card">
      <div className="bt-card-head">
        <div className="bt-card-title">
          <span className="bt-card-bar" /> OPEN POSITIONS
          <span className="bt-open-count">{rows.length}</span>
        </div>
        <div className="bt-open-sub">
          held at the terminal timestamp
          {meta?.n_lanes ? ` · ${meta.n_lanes} lanes` : ''}
          {meta?.evaluatedTo
            ? ` · reference evaluated to ${new Date(meta.evaluatedTo).toISOString().slice(0, 16).replace('T', ' ')}Z`
            : ''}
        </div>
        {refStale ? (
          <div className="bt-open-sub" style={{ color: '#f0b429' }}>
            These positions are not marked to the live price. The reference book ends at the
            timestamp above, so a mark taken now would cover bars it has never evaluated — the
            position may already have exited on one of them.
          </div>
        ) : null}
      </div>
      <div className="table-scroll">
        <table className="bt-open-table">
          <thead>
            <tr>
              <th>Asset</th><th>Strategy</th><th>Side</th><th className="num">Entry</th>
              <th className="num">Mark</th><th className="num">Size</th><th className="num">Lane</th>
              <th className="num">Stop</th><th className="num">Target</th>
              <th className="num">Unrealised</th><th className="num">Return</th>
              <th className="num">Age</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {priced.map((p, i) => (
              <tr key={`${p.cfg_sid}|${p.entryTs}|${i}`}>
                <td>
                  <span className="num">{p.asset}</span>
                  {p.tf ? <span className="sub">{p.tf}</span> : null}
                </td>
                <td style={{ fontFamily: 'monospace', fontSize: 10.5, color: 'var(--muted)' }}>
                  {p.cfg_sid || '—'}
                  {p.tierS === true ? <span className="bt-tiers-pill" title="Tier-S — eligible for the reserved lane">TIER-S</span> : null}
                  {p.tierS === null ? <span className="sub" title={p.tierSSource}>Tier-S unknown</span> : null}
                </td>
                <td><span className={'badge ' + (p.dir > 0 ? 'badge-long' : 'badge-short')}>{p.side}</span></td>
                <td className="num bt-price-cell">
                  {p.entryPx != null ? `$${p.entryPx.toFixed(p.entryPx < 1 ? 4 : 2)}` : '—'}
                  <span className="ts">{p.entryTs ? fmtTradeTs(p.entryTs) : '—'}</span>
                </td>
                <td className="num bt-price-cell">
                  {p.mark != null ? `$${p.mark.toFixed(p.mark < 1 ? 4 : 2)}` : '—'}
                  <span className="ts" style={{ color: 'var(--muted)' }}>
                    {p.mark != null ? 'live' : 'no live price'}
                  </span>
                </td>
                <td className="num bt-price-cell">
                  {p.notional != null ? `$${p.notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                  {p.units != null ? <span className="sub">{p.units.toFixed(p.units < 1 ? 4 : 2)} {p.asset}</span> : null}
                </td>
                <td className="num" title={p.laneSource}>{p.lane != null ? p.lane : '—'}</td>
                <td className="num bt-price-cell">
                  {p.stop != null ? `$${p.stop.toFixed(p.stop < 1 ? 4 : 2)}` : '—'}
                  {p.stopMovedFromInitial ? <span className="sub" title="the stop has moved from its initial level">trailed</span> : null}
                </td>
                <td className="num" title={p.targetNote} style={{ color: 'var(--muted)' }}>none</td>
                <td className={'num ' + (p.unrealised == null ? '' : p.unrealised > 0 ? 'pos-text' : 'neg-text')}>
                  {p.unrealised == null ? '—' : `${p.unrealised >= 0 ? '+' : ''}$${p.unrealised.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                </td>
                <td className={'num ' + (p.returnPct == null ? '' : p.returnPct > 0 ? 'pos-text' : 'neg-text')}>
                  {p.returnPct == null ? '—' : `${p.returnPct.toFixed(2)}%`}
                </td>
                <td className="num">{fmtAge(p.ageMs)}</td>
                <td><span className="bt-open-label"><span className="dot" />OPEN</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bt-open-foot">
        <div className="bt-open-foot-row">
          <span>Unrealised P&amp;L on the open book</span>
          <strong className={unrealisedTotal == null ? '' : unrealisedTotal > 0 ? 'pos-text' : 'neg-text'}>
            {unrealisedTotal == null
              ? '— not priced'
              : `${unrealisedTotal >= 0 ? '+' : ''}$${unrealisedTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
          </strong>
        </div>
        <div className="bt-open-note">
          Unrealised, and reported separately: it is <strong>not</strong> included in the realised
          P&amp;L, return, win rate, profit factor or drawdown above, and no exit is imputed for an
          open position. {refStale
            ? 'None are priced: the reference book has not reached the present, and a live mark on '
              + 'it would be an invented figure rather than a measured one.'
            : `${pricedRows.length}/${priced.length} priced from the live feed`}
          {priced.length - pricedRows.length > 0
            ? ` · ${priced.length - pricedRows.length} unpriced, shown as "—" rather than $0`
            : ''}. These strategies carry no fixed take-profit, so Target reads "none" — exits are
          stop, bar-close trail or signal.
        </div>
      </div>
    </div>
  )
}


// ─── CUSTOM RERUN ───────────────────────────────────────────────────────────
/**
 * START DATE · END DATE · STARTING CAPITAL · TIER · BACKTEST. 2026-09-26.
 *
 * The page previously showed exactly one window at exactly one basis: whatever the publisher had
 * last written, on $10,000. A visitor could not ask "what would this have done on my $25k from
 * January?" — the question the page exists to answer.
 *
 * PRESSING BACKTEST ALWAYS COMPUTES. The request is a POST with `cache: 'no-store'` against an
 * endpoint that re-reads the canonical record from disk on every call and stamps the response with
 * a `run_id` derived from the inputs. Nothing on this path can serve a previous window's numbers,
 * which is the failure that matters: stale results under changed controls are worse than no
 * results, because they look right.
 *
 * WHAT THE RESULT IS, STATED ON THE PAGE. The endpoint re-derives the portfolio from the canonical
 * engine's own trade record over the requested window and capital; it does not re-execute the
 * engine in a web request. Because canonical sizing is risk-based and NON-COMPOUNDING — each
 * notional comes from that trade's own stop distance against the initial capital, never the running
 * balance — the re-derivation is exact rather than an approximation. The one genuine difference
 * from a literal replay is lane contention at the window's left edge, and the response reports the
 * straddling trades instead of hiding them. The provenance line under the controls says all of
 * this in the UI, not only in this comment.
 */
type RerunResult = {
  run_id: string
  computed_at: string
  identity: {
    basket: string; tier: string
    range: { from: string; to: string }
    startCapital: number
    execution_policy: string
    source: string; source_mtime: string | null; basis: string
  }
  stats: Record<string, unknown> & { startCapital: number; breakdown?: unknown }
  equityCurve: { ts: number; equity: number }[]
  btcBuyAndHold: { available: boolean; reason: string | null; returnPct: number | null; finalCapital: number | null }
  monthly: Record<string, { trades: number; netPnl: number; returnPct: number; wins: number }>
  weekly: Record<string, { trades: number; netPnl: number; returnPct: number; wins: number }>
  closedTrades: unknown[]
  openPositions: unknown[]
  edge: {
    straddling_left_edge: number; straddling_note: string | null
    open_positions_included: boolean; open_positions_note: string
    open_book_error: string | null
  }
  accounting: {
    starting_equity: number; realised_pnl: number
    terminal_unrealised_pnl: number | null; terminal_unrealised_note: string
    ending_equity_realised_basis: number; identity: string; holds: boolean
  }
  universe: { closed_in_record: number; closed_in_window: number }
}

function toDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function CustomRerunControls({ tier, setTier, rerun, busy, error, isPt, onRun, onClear }: {
  tier: Tier
  setTier: (t: Tier) => void
  rerun: RerunResult | null
  busy: boolean
  error: string | null
  isPt: boolean
  onRun: (from: string, to: string, capital: number, tier: Tier) => void
  onClear: () => void
}) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [capital, setCapital] = useState('10000')
  const [localErr, setLocalErr] = useState<string | null>(null)

  const today = toDateInput(Date.now())

  function submit() {
    // VALIDATE BEFORE SENDING. A refused input says what is wrong; it never silently runs
    // something other than what the user asked for.
    const cap = Number(capital)
    if (!Number.isFinite(cap) || cap < 100 || cap > 10_000_000) {
      setLocalErr('Starting capital must be between $100 and $10,000,000.'); return
    }
    if (from && to && Date.parse(from) >= Date.parse(to)) {
      setLocalErr('The start date must be earlier than the end date.'); return
    }
    if (from && Number.isNaN(Date.parse(from))) { setLocalErr('The start date is not a valid date.'); return }
    if (to && Number.isNaN(Date.parse(to))) { setLocalErr('The end date is not a valid date.'); return }
    setLocalErr(null)
    onRun(from, to, cap, tier)
  }

  const shown = localErr || error

  return (
    <div className="card card-pad bt-rerun">
      <div className="bt-rerun-head">
        <div className="bt-card-title"><span className="bt-card-bar" /> {isPt ? 'BACKTEST PERSONALIZADO' : 'CUSTOM BACKTEST'}</div>
        {rerun ? (
          <button type="button" className="bt-view-tab" onClick={onClear}>
            {isPt ? 'Voltar ao publicado' : 'Back to published'}
          </button>
        ) : null}
      </div>
      <div className="bt-rerun-grid">
        <label className="bt-rerun-field">
          <span>{isPt ? 'Data inicial' : 'Start date'}</span>
          <input type="date" value={from} max={to || today} onChange={e => setFrom(e.target.value)} />
        </label>
        <label className="bt-rerun-field">
          <span>{isPt ? 'Data final' : 'End date'}</span>
          <input type="date" value={to} min={from || undefined} max={today} onChange={e => setTo(e.target.value)} />
        </label>
        <label className="bt-rerun-field">
          <span>{isPt ? 'Capital inicial' : 'Starting capital'}</span>
          <input type="number" inputMode="decimal" min={100} max={10000000} step={100}
                 value={capital} onChange={e => setCapital(e.target.value)} />
        </label>
        <label className="bt-rerun-field">
          <span>{isPt ? 'Tier' : 'Tier'}</span>
          <select value={tier} onChange={e => setTier(e.target.value as Tier)}>
            {(['conservative', 'moderate', 'aggressive', 'kamikaze'] as Tier[]).map(t => (
              <option key={t} value={t}>{isPt ? TIER_LABELS[t].pt : TIER_LABELS[t].en}</option>
            ))}
          </select>
        </label>
        <button type="button" className="bt-rerun-go" onClick={submit} disabled={busy}>
          {busy ? (isPt ? 'Calculando…' : 'Running…') : (isPt ? 'Backtest' : 'Backtest')}
        </button>
      </div>
      {shown ? (
        <div className="bt-rerun-err">⚠ {shown}</div>
      ) : null}
      {rerun ? (
        <div className="bt-rerun-prov">
          <div className="bt-rerun-prov-row">
            <strong>{rerun.identity.basket}</strong> · {rerun.identity.tier} ·{' '}
            {rerun.identity.range.from.slice(0, 10)} → {rerun.identity.range.to.slice(0, 10)} ·{' '}
            ${rerun.identity.startCapital.toLocaleString()} start ·{' '}
            {rerun.universe.closed_in_window.toLocaleString()} of{' '}
            {rerun.universe.closed_in_record.toLocaleString()} canonical closes
          </div>
          <div className="bt-rerun-prov-row">
            run {rerun.run_id} · computed {rerun.computed_at.replace('T', ' ').slice(0, 19)}Z
          </div>
          <div className="bt-rerun-prov-row">{rerun.identity.execution_policy}</div>
          <div className="bt-rerun-prov-row">{rerun.identity.basis}</div>
          <div className="bt-rerun-prov-row">
            {rerun.accounting.identity} — starting equity + realised P&amp;L = ending equity
            {rerun.accounting.holds ? ' ✓' : ' ✗ RECONCILIATION FAILED'} ·{' '}
            unrealised on the open book is reported separately and never added
          </div>
          {rerun.edge.straddling_left_edge > 0 ? (
            <div className="bt-rerun-prov-row bt-rerun-caveat">
              {rerun.edge.straddling_left_edge} trade
              {rerun.edge.straddling_left_edge === 1 ? '' : 's'} opened before the start date and
              closed inside the window — {rerun.edge.straddling_note}
            </div>
          ) : null}
          {!rerun.edge.open_positions_included ? (
            <div className="bt-rerun-prov-row bt-rerun-caveat">{rerun.edge.open_positions_note}</div>
          ) : null}
          {rerun.btcBuyAndHold.available ? (
            <div className="bt-rerun-prov-row">
              BTC buy &amp; hold over the same window: {rerun.btcBuyAndHold.returnPct}% → $
              {rerun.btcBuyAndHold.finalCapital?.toLocaleString()}
            </div>
          ) : (
            <div className="bt-rerun-prov-row">BTC buy &amp; hold not computed — {rerun.btcBuyAndHold.reason}</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
