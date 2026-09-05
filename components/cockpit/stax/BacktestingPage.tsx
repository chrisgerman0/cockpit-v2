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
import { fetchPortfolioTrades, fetchAdminPortfolioTrades, fetchShadowFeed, mergePublisherAndShadow, fetchClosedTrades, fetchForwardOpens, LIVEREF_BASE, isEodMarker, prettyExitReason, prewarmAllTiers, isTierCached, type PortfolioTrade, type Tier } from '@/lib/use-portfolio-trades'
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
const LIVE_DATA_BASE = '/data/strategies/phase-h-risk'
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
  const [stats, setStats] = useState<Stats | null>(null)
  // `trades` is CLOSED only — every metric on this page is computed against
  // it. `allTrades` is the raw set (closed + the strategy's currently-open
  // eod markers) — passed to the List of Trades so users can see what the
  // strategy is holding right now and compare with their own Bitget positions.
  const [trades, setTrades] = useState<PortfolioTrade[]>([])
  const [allTrades, setAllTrades] = useState<PortfolioTrade[]>([])
  const [view, setView] = useState<'metrics' | 'trades'>('metrics')
  // 2026-06-12: compounding toggle (OFF by default = the canonical compound-off
  // display the producer serves). ON recomputes the headline metrics + equity curve
  // client-side by reinvesting each trade's flat-base return on the running equity.
  const [compound, setCompound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [updatedAgo, setUpdatedAgo] = useState<string | null>(null)
  const [updatedAgoMins, setUpdatedAgoMins] = useState<number | null>(null)
  const { isAdmin } = useIsAdmin()

  // 2026-06-01 71-cfg cutover PREVIEW: ?preview=1 points the page at the
  // staging publisher output (/data/strategies/phase-h-preview) so the full
  // new backtest (metrics, curves, counts, would-be-opens) can be reviewed
  // before the live 62-cfg files are overwritten. Live traffic (no param) is
  // byte-identical to before. Removable after promote.
  const previewMode = useMemo(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1',
    [],
  )
  const dataBase = previewMode ? '/data/strategies/phase-h-preview' : LIVE_DATA_BASE

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
      const useTwoStore = !wantAdmin && !previewMode
      const tradesFetcher = wantAdmin && adminToken
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
            : previewMode
              ? fetch(tradesPath(tier, dataBase), { cache: 'no-store' })
                  .then(r => (r.ok ? (r.json() as Promise<PortfolioTrade[]>) : []))
                  .catch(() => [] as PortfolioTrade[])
              : tradesFetcher(true).catch(() => [] as PortfolioTrade[]),
          previewMode
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
        let pubTrades: PortfolioTrade[]
        let metricsClosed: PortfolioTrade[]
        if (useTwoStore && immutableClosed && immutableClosed.length) {
          pubTrades = [...immutableClosed, ...(fwdTrades as PortfolioTrade[])]
          metricsClosed = immutableClosed
        } else {
          const fwdAll = fwdTrades as PortfolioTrade[]
          pubTrades = fwdAll
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
        const rawTrades = wantAdmin ? pubTrades : mergePublisherAndShadow(pubTrades, shadowTrades, tier)
        // 2026-06-12 (a): display-cap the open book at the tier's lane count
        // (2/4/6) so the LIST never shows more concurrent opens than the tier
        // can hold (publisher over-fill = issue (c), under investigation).
        setAllTrades(capOpensForTier(rawTrades, tier))
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
    const chrono = [...trades].sort((a, b) => a.exitTs - b.exitTs)
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
    const chrono = [...trades].sort((a, b) => a.exitTs - b.exitTs)
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
      {/* Header */}
      <div className="bt-header">
        <div className="bt-eyebrow">{previewMode ? 'SWINGMATE v3 SUPER STACK · 18-ASSET BASKET · PREVIEW' : 'SWINGMATE v3 SUPER STACK · 18-ASSET BASKET'}</div>
        <h1 className="bt-title">
          {isPt ? <>Performance <span className="bt-title-gold">verificada.</span></> : <>Verified <span className="bt-title-gold">performance.</span></>}
        </h1>
        <p className="bt-blurb">
          {isPt
            ? <>Backtest verificado da super-stack sistemática multi-ativo em {PHASE_H_BASKET.length} ativos. <strong>Os números abaixo refletem o tier selecionado em uma conta de $10.000 com alavancagem cross-margin Bitget (1×/3×/6×/9×).</strong> Inclui custos modelados de funding rate Bitget (~2% do PnL bruto).</>
            : <>Verified backtest of the systematic multi-asset super stack across {PHASE_H_BASKET.length} assets. <strong>Numbers reflect the selected tier on a $10,000 account with Bitget cross-margin leverage (1×/3×/6×/9×).</strong> Includes modelled Bitget funding rate cost (~2% of gross PnL).</>}
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
          <span>{trades.length.toLocaleString()} trades</span>
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
          value={trades.length > 0 ? trades.length.toLocaleString() : '—'} />
        <MetricCard label={isPt ? 'Taxa de Acerto' : 'Win Rate'}
          value={derivedStats ? `${derivedStats.winRate.toFixed(2)}%` : '—'} positive />
        <MetricCard label={isPt ? 'Fator de Lucro' : 'Profit Factor'}
          value={derivedStats ? derivedStats.profitFactor.toFixed(2) : '—'} />
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
          {' '}{isPt ? `Cesta de ${PHASE_H_BASKET.length} ativos` : `${PHASE_H_BASKET.length}-asset basket`} ·
          {' '}{trades.length > 0 ? `${(((trades[trades.length - 1].exitTs - trades[0].entryTs) / 86400000 / 365)).toFixed(1)}yr backtest` : ''}
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
        <MetricsView stats={stats} trades={trades} loading={loading} tier={tier} isPt={isPt} compound={compound} />
      ) : (
        <TradesTable trades={allTrades} loading={loading} isPt={isPt} showCfgColumn={isAdmin === true} compound={compound} compoundRows={compoundRows} />
      )}
    </div>
  )
}

// ─── Metrics view (all sections) ────────────────────────────────────────────

function MetricsView({ stats, trades, loading, tier, isPt, compound }: {
  stats: Stats | null
  trades: PortfolioTrade[]
  loading: boolean
  tier: Tier
  isPt: boolean
  compound: boolean
}) {
  if (loading) return <div className="card card-pad">Loading…</div>
  if (!trades.length) return <div className="card card-pad">No trade data.</div>

  return (
    <>
      <EquityCurveSection trades={trades} stats={stats} isPt={isPt} compound={compound} />
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
    </>
  )
}

// ─── Equity curve with Log/Linear toggle + BTC B&H comparison ───────────────

function EquityCurveSection({ trades, stats, isPt, compound }: { trades: PortfolioTrade[]; stats: Stats | null; isPt: boolean; compound: boolean }) {
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
    const chrono = [...trades].sort((a, b) => a.exitTs - b.exitTs)

    // Sample density. Bumped 250 → 1500 (2026-05-26) so the curve no longer
    // skips over short-duration drawdowns and rallies — at 250 samples on a
    // 15k-trade ledger a single sample covered 60 trades, hiding meaningful
    // intra-window shape. 1500 is still well below the input size (so we
    // get genuine subsampling, not aliasing artifacts) but ~6× the previous
    // resolution.
    let eq = startCap
    const SAMPLE = 1500
    const step = Math.max(1, Math.floor(chrono.length / SAMPLE))
    const strategy: EquityPoint[] = [{ ts: chrono[0].entryTs, value: startCap, month: '' }]
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
    let bhPoints: EquityPoint[] = []
    if (btcChrono.length > 0) {
      const firstPx = btcChrono[0].entryPx
      const BH_SAMPLE = 1500
      const bhStep = Math.max(1, Math.floor(btcChrono.length / BH_SAMPLE))
      bhPoints = btcChrono.filter((_, i) => i % bhStep === 0 || i === btcChrono.length - 1).map(t => ({
        ts: t.exitTs,
        value: Math.max(1, Math.round((startCap * (t.exitPx / firstPx)) * 100) / 100),
        month: '',
      }))
    }
    return { strategy, bhPoints }
  }, [trades, stats?.startCapital, compound])

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
          <span className="bt-legend-swatch" style={{ background: 'var(--gold)' }} /> Satoshi Stacker
        </button>
        {hasBh ? (
          <button
            type="button"
            className={'bt-legend-item' + (show.bh ? '' : ' off')}
            onClick={() => setShow(s => ({ ...s, bh: !s.bh }))}
            aria-pressed={show.bh}
          >
            <span className="bt-legend-swatch bt-legend-swatch-dashed" /> BTC Buy &amp; Hold
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
              <span className="bt-eq-tooltip-label">Satoshi Stacker</span>
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

type SaRow = { sid: string; sa_trades: number; sa_winRate: number; sa_profitFactor: number
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
  const [sa, setSa] = useState<Record<string, SaRow>>({})
  useEffect(() => {
    let cancelled = false
    fetch('/data/cfg-quality-leaderboard.json', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d?.rows) return
        const m: Record<string, SaRow> = {}
        for (const r of d.rows as SaRow[]) m[r.sid] = r
        setSa(m)
      })
      .catch(() => {})   // absent file => SA cells render "—"; never breaks the page
    return () => { cancelled = true }
  }, [])
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null)
  useEffect(() => { setExpandedAsset(null) }, [tier])
  return (
    <div className="card card-pad">
      <div className="bt-card-head">
        <div className="bt-card-title"><span className="bt-card-bar" /> {isPt ? 'POR ATIVO' : 'PER-ASSET BREAKDOWN'}</div>
        <span className="bt-tier-tag">{tier.toUpperCase()} TIER</span>
      </div>
      <div className="bt-card-sub">
        Satoshi Stacker · single $10,000 account · 1× notional/trade ({tier} tier)
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
                    <td className="num" style={{ textAlign: 'right' }}>{row.totalTrades.toLocaleString()}</td>
                    <td className={'num pos-text'} style={{ textAlign: 'right' }}>+{row.returnPct.toFixed(2)}%</td>
                    <td className="num" style={{ textAlign: 'right', color: 'var(--gold)' }}>{row.winRate.toFixed(1)}%</td>
                    <td className="num" style={{ textAlign: 'right' }}>{row.profitFactor.toFixed(2)}</td>
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
                      <td className="num" style={{ textAlign: 'right', fontSize: '0.85em', color: 'var(--gold)' }}>{(c.winRate ?? 0).toFixed(1)}%</td>
                      <td className="num" style={{ textAlign: 'right', fontSize: '0.85em' }}>{(c.profitFactor ?? 0).toFixed(2)}</td>
                        {(() => {
                          const q = sa[sid]
                          const cell = (v: React.ReactNode, extra: React.CSSProperties = {}) => (
                            <td className="num" style={{ textAlign: 'right', fontSize: '0.85em', ...extra }}>{v}</td>
                          )
                          if (!q) return <td colSpan={6} style={{ textAlign: 'right', opacity: 0.3, fontSize: '0.72em', borderLeft: '2px solid rgba(212,175,55,0.35)' }}>—</td>
                          return (<>
                            {cell(q.sa_trades, { borderLeft: '2px solid rgba(212,175,55,0.35)' })}
                            {cell(`${q.sa_winRate.toFixed(1)}%`)}
                            {cell(q.sa_profitFactor.toFixed(2), { color: q.sa_profitFactor >= 1 ? 'var(--gold)' : '#ef4444', fontWeight: 600 })}
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
                        <br /><strong>Right of the divider — STANDALONE</strong> (locked risk-sized, every signal the cfg fires, no lane competition). These <strong>do NOT sum to the parent and are not meant to</strong> — they count trades the book never seated. Standalone judges the CFG; seated measures the BOOK. <strong>GAP</strong> is what lane competition cost.
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

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
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
          <SplitRow label={isPt ? 'Taxa de Acerto' : 'Win Rate'} all={`${cols.all.winRate.toFixed(2)}%`} long={`${cols.long.winRate.toFixed(2)}%`} short={`${cols.short.winRate.toFixed(2)}%`} />
          <SplitRow label={isPt ? 'Vitória Média' : 'Avg Win'} all={`$${cols.all.avgWin.toFixed(2)}`} long={`$${cols.long.avgWin.toFixed(2)}`} short={`$${cols.short.avgWin.toFixed(2)}`} />
          <SplitRow label={isPt ? 'Perda Média' : 'Avg Loss'} all={`$${cols.all.avgLoss.toFixed(2)}`} long={`$${cols.long.avgLoss.toFixed(2)}`} short={`$${cols.short.avgLoss.toFixed(2)}`} />
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
          <Row label={isPt ? 'Fator de Lucro' : 'Profit Factor'} value={ra.profitFactor.toFixed(2)} />
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

function MetricCard({ label, value, sub, positive, negative }: { label: string; value: string; sub?: string; positive?: boolean; negative?: boolean }) {
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

function TradesTable({ trades, loading, isPt, showCfgColumn = false, compound = false, compoundRows = null }: { trades: PortfolioTrade[]; loading: boolean; isPt: boolean; showCfgColumn?: boolean; compound?: boolean; compoundRows?: CompoundView | null }) {
  const [page, setPage] = useState(0)
  const [coin, setCoin] = useState<CoinFilter>('ALL')
  const [side, setSide] = useState<SideFilter>('ALL')
  const PAGE = 50

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

  const filtered = useMemo(() => {
    return trades.filter(tr => {
      if (coin !== 'ALL' && canonicalAsset(tr.symbol) !== coin) return false  // rebrand-aware: GRAM chip matches old TON-labeled rows
      if (side === 'LONG' && tr.dir <= 0) return false
      if (side === 'SHORT' && tr.dir >= 0) return false
      return true
    })
  }, [trades, coin, side])

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
              const livePx = open ? priceBySymbol.get(tr.symbol) : undefined
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
