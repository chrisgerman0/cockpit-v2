'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import './stax-design.css'
import { Icons } from './Icons'
import { useLiveTradingData, type LiveTradingData, type CfgDims } from '@/lib/use-live-trading-data'
import { usePublicTickers } from '@/lib/use-public-tickers'
import { useT, getCurrentLang } from '@/lib/i18n'
import { computeProgressBarState, type ProgressBarState } from '@/lib/cfg-progress'
// 2026-05-24 (P5): 14-asset Phase H basket — single source of truth lives at
// lib/phase-h-basket.ts. Replaces the hardcoded 7-asset V1 list that was
// hiding HYPE / BNB / AVAX / ADA / TRX / ZEC / TON from the customer view.
import {
  PHASE_H_SYMBOLS,
  ASSET_LOGOS as BASKET_LOGOS,
  COIN_FILTERS as BASKET_COIN_FILTERS,
  type CoinFilter as BasketCoinFilter,
  type PhaseHAsset,
  type PhaseHSymbol,
} from '@/lib/phase-h-basket'

/**
 * Throttle a high-frequency value down to one update per `ms` window.
 * The latest input is captured every render via a ref; the displayed
 * state advances on a timer. Used by SLDangerCell so the Bitget WS
 * tick stream (5–10/s for liquid pairs) doesn't reflect into bar +
 * caption updates at WS cadence. ~750ms feels live without flicker.
 */
function useThrottledValue<T>(value: T, ms: number): T {
  const [snapshot, setSnapshot] = useState(value)
  const latest = useRef(value)
  latest.current = value
  useEffect(() => {
    const id = window.setInterval(() => {
      setSnapshot(prev => (Object.is(prev, latest.current) ? prev : latest.current))
    }, ms)
    return () => window.clearInterval(id)
  }, [ms])
  return snapshot
}

function fmtUsdSign(v: number): string {
  const abs = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v >= 0 ? `+$${abs}` : `−$${abs}`
}
function fmtPctSign(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

// Empty placeholder shown while data is loading — keeps the layout intact
// instead of a full-page "Loading…" screen. Numbers render as "—".
const EMPTY_LIVE_DATA: LiveTradingData = {
  active: null,
  closed: [],
  open: [],
  totals: {
    realizedPnl: 0, realizedPct: 0, closedCount: 0,
    winRate: 0, wins: 0, losses: 0,
    bestTrade: 0, worstTrade: 0, avgWin: 0, avgLoss: 0,
  },
  // 2026-05-24 (P5): asset list now derives from PHASE_H_SYMBOLS so the
  // Live Trading page shows all 14 basket assets, not just the legacy 7.
  assetStates: PHASE_H_SYMBOLS.map(symbol => ({
    sym: symbol.replace('USDT', '') as PhaseHAsset,
    symbol,
    side: 'FLAT' as const,
  })),
  startCapital: 0,
  currentEquity: 0,
  unrealizedPnl: 0,
  lastUpdatedMs: Date.now(),
}

export function LiveTradingContent() {
  const state = useLiveTradingData()

  // Render the full layout immediately (with empty data) so navigation feels
  // instant. Real numbers swap in once the hook resolves; the page never
  // shows a blocking "Loading…" splash.
  if (state.status === 'loading') return <LiveTradingView data={EMPTY_LIVE_DATA} />

  if (state.status === 'unauthenticated') return <CenterMessage title="Sign in to see live trading" body="Log in at staxs.ai to load your trading data." action={{ label: 'Go to login', href: 'https://staxs.ai/login' }} />
  if (state.status === 'no-keys') return <CenterMessage title="Connect your Bitget account" body="Add API keys in Settings to see live positions." action={{ label: 'Connect API keys', href: '/onboarding' }} />
  if (state.status === 'no-bot') return <CenterMessage title="Bot not activated yet" body="Run the activation wizard to arm the bot." action={{ label: 'Open wizard', href: '/?setup=bot' }} />
  if (state.status === 'error') return <CenterMessage title="Couldn’t load live trading" body={state.message} />

  return <LiveTradingView data={state.data} />
}

function LiveTradingView({ data }: { data: LiveTradingData }) {
  // Live tickers — drive per-tick PnL recomputation in the openRows memo
  // below. Critical: data hook does NOT depend on tickers (would cause a
  // load loop), so per-tick mark price overlay happens HERE at render
  // time. Cheap re-render, no fetch.
  const tickers = usePublicTickers(30000)
  const tickerByPair = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of tickers) m[t.symbol] = t.price
    return m
  }, [tickers])

  // Open positions = USER's actual Bitget positions (not strategy backtest).
  // PnL recomputed on every ticker tick using live mark prices. Falls back
  // to whatever data.open's pnlUsd carries (server-side computed) if no
  // ticker yet.
  const openRows: LiveTradeRow[] = useMemo(() =>
    data.open.map(t => {
      const tickerPx = tickerByPair[t.pair] || 0
      let pnl = t.pnlUsd
      let pnlPct = t.pnlPct
      // markPx must NEVER fall back to entry — that produces a phantom
      // "0% PnL" snapshot which trips inProfit=TRUE in the Pulse cell and
      // flickers SOL/etc between red and green when the WS ticker drops a
      // beat. Priority: live ticker → server-computed pnlPct back-derived
      // against entry → null (cell shows dashes, no false-positive).
      let markPx: number | null = null
      if (tickerPx > 0 && t.entry > 0 && t.sizeUnits > 0) {
        const dir = t.side === 'LONG' ? 1 : -1
        pnl = (tickerPx - t.entry) * t.sizeUnits * dir
        pnlPct = ((tickerPx - t.entry) / t.entry) * 100 * dir
        markPx = tickerPx
      } else if (t.entry > 0 && Number.isFinite(t.pnlPct)) {
        // Reconstruct mark from server pnlPct so the cell never sees
        // mark == entry on a ticker dropout.
        markPx = t.side === 'LONG'
          ? t.entry * (1 + t.pnlPct / 100)
          : t.entry * (1 - t.pnlPct / 100)
      }
      return {
        symbol: t.pair,
        sym: t.sym,
        side: t.side,
        notional: t.sizeUsd,
        entryPx: t.entry,
        entryTs: t.openedAt ?? 0,
        exitPx: null,
        exitTs: null,
        pnl,
        pnlPct,
        reason: t.pyramided ? 'Open · Pyramided' : 'Open',
        open: true,
        markPx,
        mfePct: t.mfePct,
        mfePxPeak: t.mfePxPeak ?? null,
        tpArmed: t.tpArmed,
        trailFloor: t.trailFloor ?? null,
        trailFloorCommitted: !!t.trailFloorCommitted,
        mfePeakTs: t.mfePeakTs ?? null,
        // 2026-05-27: cfg dims for cfg-aware progress bar. Undefined for
        // positions outside the Phase H basket (orphan trades).
        cfgDims: t.cfgDims,
      }
    }),
    [data.open, tickerByPair],
  )

  const closedRows: LiveTradeRow[] = useMemo(() =>
    [...data.closed]
      .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
      .map(t => ({
        symbol: t.pair,
        sym: t.sym,
        side: t.side,
        notional: t.sizeUsd,
        entryPx: t.entry,
        entryTs: t.openedAt ?? 0,
        exitPx: t.exit,
        exitTs: t.closedAt,
        pnl: t.pnlUsd,
        pnlPct: t.pnlPct,
        reason: t.reason || '—',
        open: false,
      })),
    [data.closed],
  )

  return (
    <div className="stax-page">
      <PageHeader lastUpdatedMs={data.lastUpdatedMs} hasOpen={openRows.length > 0} />
      {/* 2026-05-26 Unrealized PnL fix: pass the live-recomputed sum from
          openRows (each row's pnl is updated on every ticker tick via the
          openRows memo above). Previously we passed `data.unrealizedPnl`
          which is the 30s-old Bitget snapshot from /api/balance — caused
          the top card to lag the position-row PnL by up to a full polling
          cycle, with no movement between polls. */}
      <StatsRow totals={data.totals} unrealizedPnl={openRows.reduce((s, r) => s + (Number.isFinite(r.pnl) ? r.pnl : 0), 0)} openCount={openRows.length} />
      <LiveTradesTable
        title="OPEN POSITIONS"
        rows={openRows}
        emptyText="No open positions yet. Your next trade will appear here when a signal fires."
        lastColLabel="Pulse"
      />
      <LiveTradesTable
        title="TRADE HISTORY"
        rows={closedRows}
        emptyText="No closed trades yet."
      />
    </div>
  )
}

// ─── Header ─────────────────────────────────────────────────────────────────

function PageHeader({ lastUpdatedMs, hasOpen }: { lastUpdatedMs: number; hasOpen: boolean }) {
  const t = useT()
  const isPt = getCurrentLang() === 'PT'
  const ts = new Date(lastUpdatedMs).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  // Hero matches /v2/backtesting structure exactly: gold eyebrow with 18px
  // bar → big two-tone heading (gradient only on the accent word) → muted
  // blurb → mono timestamp. The standalone "Live Trading" page-name block
  // was removed so this page mirrors the backtesting layout 1:1.
  return (
    <div className="bt-header" style={{ marginBottom: 14 }}>
      <div className="bt-eyebrow">{t('live.myPosition')}</div>
      <h1 className="bt-title">
        {isPt
          ? <>Suas posições <span className="bt-title-gold">ativas.</span></>
          : <>Your active <span className="bt-title-gold">positions.</span></>}
      </h1>
      <p className="bt-blurb" style={{ maxWidth: 600 }}>{t('live.realtimeView')}</p>
      <p style={{ fontSize: 11, color: 'var(--muted)', opacity: 0.5, fontFamily: 'JetBrains Mono, monospace', marginTop: 6 }}>{ts}</p>
    </div>
  )
}

// ─── Stats row ──────────────────────────────────────────────────────────────

function StatsRow({ totals, unrealizedPnl, openCount }: { totals: LiveTradingData['totals']; unrealizedPnl: number; openCount: number }) {
  const realizedClass = totals.realizedPnl >= 0 ? 'pos' : 'neg'
  const unrealizedClass = unrealizedPnl >= 0 ? 'pos' : 'neg'
  return (
    <div className="row row-stats">
      <Stat icon={Icons.Bars}    label="Total Trades"   value={String(totals.closedCount)} sub={totals.closedCount === 0 ? 'No history' : `Avg win ${fmtUsdSign(totals.avgWin)} · Avg loss ${fmtUsdSign(-totals.avgLoss)}`} />
      <Stat icon={Icons.TrendUp} label="Win Rate"       value={totals.closedCount === 0 ? '—' : `${totals.winRate}%`} sub={`${totals.wins} wins · ${totals.losses} losses`} />
      <Stat icon={Icons.TrendUp} label="Unrealized PnL" value={openCount === 0 ? '$0' : fmtUsdSign(unrealizedPnl)} sub={openCount === 0 ? 'No open position' : `${openCount} ${openCount === 1 ? 'leg' : 'legs'} open`} valueClass={openCount === 0 ? '' : unrealizedClass} />
      <Stat icon={Icons.Check}   label="Realized PnL"   value={totals.closedCount === 0 ? '$0' : fmtUsdSign(totals.realizedPnl)} sub={totals.closedCount === 0 ? 'No closed trades yet' : `Best ${fmtUsdSign(totals.bestTrade)} · Worst ${fmtUsdSign(totals.worstTrade)}`} valueClass={totals.closedCount === 0 ? '' : realizedClass} />
      <Stat icon={Icons.Star}    label="Total Return"   value={totals.closedCount === 0 ? '—' : fmtPctSign(totals.realizedPct)} sub="Since activation" valueClass={totals.closedCount === 0 ? '' : realizedClass} />
    </div>
  )
}

function Stat({ icon: Ico, label, value, sub, valueClass }: { icon: React.ComponentType<{ size?: number }>; label: string; value: string; sub: string; valueClass?: string }) {
  return (
    <div className="card stat-card">
      <div className="stat-head">
        <div className="stat-ico"><Ico size={16} /></div>
        <div className="label">{label}</div>
      </div>
      <div className={'stat-val num' + (valueClass ? ' ' + valueClass : '')}>{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  )
}

// ─── List-of-Trades clone (matches /v2/backtesting List of Trades 1:1) ─────

type LiveTradeRow = {
  symbol: string
  // 2026-05-24 (P5): expanded to PhaseHAsset (14 symbols) so HYPE/BNB/AVAX/
  // ADA/TRX/ZEC/TON render with proper type-narrowing on the trade table.
  sym: PhaseHAsset
  side: 'LONG' | 'SHORT'
  notional: number       // USD per leg (×2 if pyramided)
  entryPx: number
  entryTs: number
  exitPx: number | null  // null when open
  exitTs: number | null
  pnl: number            // USD; for open rows = unrealised
  pnlPct: number
  reason: string
  open: boolean
  // Live mark price for open rows — used by the Pulse meter in the trailing
  // column. Closed rows leave this null and render the reason text.
  markPx?: number | null
  // Engine-state passthrough (open rows only) used by the Pulse meter.
  mfePct?: number
  mfePxPeak?: number | null
  tpArmed?: boolean             // BB+RSI stretched-exit armed (separate feature)
  trailFloor?: number | null    // engine-committed floor OR API-synthesized projection
  trailFloorCommitted?: boolean // true if engine actually locked; false = projection only
  mfePeakTs?: number | null
  // 2026-05-27: Phase H cfg dims for cfg-aware progress bar. Surfaced by
  // /api/trades-live → use-live-trading-data → here. When present, the
  // cell renders the cfg-aware ProgressBarState via lib/cfg-progress.ts.
  // When undefined, falls back to the legacy SLDangerCell hardcoded logic.
  cfgDims?: CfgDims
}

// 2026-05-24 (P5): swapped 7-asset hardcoded map for the 14-asset basket-
// derived map in lib/phase-h-basket.ts.
const ASSET_LOGOS: Record<string, string> = BASKET_LOGOS as Record<string, string>

// 2026-05-24 (P5): basket-derived CoinFilter — 14 assets + ALL.
type CoinFilter = BasketCoinFilter
type SideFilter = 'ALL' | 'LONG' | 'SHORT'

const COIN_FILTERS: CoinFilter[] = BASKET_COIN_FILTERS
const SIDE_FILTERS: SideFilter[] = ['ALL', 'LONG', 'SHORT']

function fmtTradeTs(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
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

/**
 * Inline SVG used by the Pulse meter — shield with a tick, paired with
 * the green "Profit locked" caption. Lives here (not in Icons.tsx) since
 * it's the only meter icon left after we collapsed the armed-vs-locked
 * distinction down to a simpler red → yellow → green sequence.
 */
function IconShieldCheck({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 4 6v6c0 4.5 3.4 8.4 8 9 4.6-.6 8-4.5 8-9V6l-8-3Z" />
      <path d="m9 12 2.2 2.2L15 10.4" />
    </svg>
  )
}

/**
 * Single dynamic Pulse meter for OPEN POSITIONS' trailing column.
 *
 * Three colours, distance-based labels:
 *
 *   RED — losing
 *     bar grows 0→100% as price moves toward the stop
 *     label: "X.XX% to Stop Loss"  (or "Stop loss approaching" inside 0.5%)
 *
 *   YELLOW — winning, before the trailing threshold
 *     bar grows 0→100% as profit climbs to the trailing-arm threshold
 *     label: "X.XX% to start Take Profit Trailing"
 *
 *   GREEN — winning, past the trailing threshold (whether locked or not)
 *     bar pinned at 100% with a sustained soft glow
 *     label:
 *       - if engine has confirmed the protection floor → "Trailing"
 *       - otherwise (still in the warm-up window)      → "Xmin to start Trailing"
 *
 *  Reprieve countdown is computed client-side from `mfePeakTs` (server
 *  derives it from engine.startedAt + mfeAt1m × 60s). Tier picked off
 *  the strategy's published reprieve table so the countdown is honest.
 *  If a position falls out of green back below the threshold, the bar
 *  falls back to yellow automatically.
 */
function SLDangerCell({
  entry, mark, side, mfePct, mfePxPeak, tpArmed, trailFloor, trailFloorCommitted, mfePeakTs,
}: {
  entry: number
  // Mark MUST come from a real source (live ticker or server-derived from
  // pnlPct). The caller never substitutes `entry` here — that would yield
  // a phantom 0% PnL snapshot which trips the green-zone branch and
  // flickers the cell during ticker dropouts.
  mark: number | null
  side: 'LONG' | 'SHORT'
  // Strategy MFE (monotonic peak-PnL %). Used to gate the GREEN zone
  // independently of the live mark, so a position bouncing around the
  // arming threshold doesn't flicker green↔yellow on every tick.
  mfePct?: number
  // Swing-high price (swing-low for shorts) — the right edge of the
  // trail-meter bar.
  mfePxPeak?: number | null
  // BB+RSI stretched-exit armed (engine `pos.armed`). Separate from the
  // trailing TP — keeps the bar green even if the trail isn't in play.
  tpArmed?: boolean
  // Protection floor value. May be either an engine-committed value or an
  // API-side projection of where the engine WILL arm. The committed flag
  // disambiguates so the bar renders honestly:
  //   committed → solid mark + "Trailing · X.XX% to take profit"
  //   projected → dashed mark + "Projected · arms in Y min"
  trailFloor?: number | null
  trailFloorCommitted?: boolean
  // ms epoch of the MFE peak — anchor for the reprieve countdown when the
  // engine hasn't committed yet. Each tier (1.5/3/5/8% MFE) has its own
  // reprieve window (90/120/180/240 min); peak must hold that long before
  // strategy.js commits a real `trailFloor`.
  mfePeakTs?: number | null
}) {
  if (!Number.isFinite(entry) || entry <= 0 || mark == null || !Number.isFinite(mark) || mark <= 0) {
    return <span style={{ color: 'var(--muted)' }}>—</span>
  }
  // Mark comes from the Bitget WS stream which can push 5–10 ticks/sec
  // on liquid pairs. A single 750ms throttle keeps the bar + caption in
  // sync, smooth, and updating with price action without per-tick
  // re-rendering. Mono digits + tabular-nums prevent any width jitter
  // when numbers change (see .lt-sl-cell + .lt-num in stax-design.css).
  const stableMark = useThrottledValue(mark, 750)

  // ───── Strategy-shaped constants ─────────────────────────────────────
  //  SL_BASE_PCT     : stop-loss sits 4% from entry (LONG: -4%, SHORT: +4%)
  //  ARM_PCT         : minimum MFE before "green zone" turns on
  //  TRAIL_MARK_PCT  : fixed visual position of the trail line on the bar
  //                    (only used in ACTIVE mode, when the engine has
  //                    committed a real trailFloor)
  // ──────────────────────────────────────────────────────────────────────
  const SL_BASE_PCT = 4
  const ARM_PCT = 1.5
  const TRAIL_MARK_PCT = 20

  const slPx = side === 'LONG' ? entry * (1 - SL_BASE_PCT / 100) : entry * (1 + SL_BASE_PCT / 100)
  const movePct = side === 'LONG' ? ((stableMark - entry) / entry) * 100 : ((entry - stableMark) / entry) * 100
  const cushion = side === 'LONG' ? ((stableMark - slPx) / stableMark) * 100 : ((slPx - stableMark) / stableMark) * 100

  const isPastSL = cushion < 0
  const isCritical = cushion >= 0 && cushion < 0.5
  const inProfit = movePct >= 0

  // Peak (MFE) — monotonic high water mark from the engine. peakValid is
  // true when peak sits beyond entry (in the profitable direction).
  const peakValid = typeof mfePxPeak === 'number' && Number.isFinite(mfePxPeak)
    && (side === 'LONG' ? mfePxPeak > entry : mfePxPeak < entry)
  const peakPctForArm = typeof mfePct === 'number' ? mfePct : movePct
  const aboveThreshold = peakPctForArm >= ARM_PCT
  const isTpArmed = !!tpArmed
  const inGreenZone = aboveThreshold || isTpArmed

  // Engine-committed trail floor. Only "ACTIVE" mode geometry kicks in
  // when this is set — otherwise we fall through to PRE-TRAIL mode (the
  // entry→peak progression) so we never paint a trail line for a state
  // that doesn't physically exist yet.
  const engineTrailValid = typeof trailFloor === 'number' && Number.isFinite(trailFloor) && trailFloor > 0
    && (side === 'LONG' ? trailFloor > entry : trailFloor < entry)

  // HYSTERESIS — drop the `inProfit` requirement that used to live here.
  // Once a position has peaked past the arming threshold (mfePct ≥ 1.5%),
  // it stays in the GREEN PRE-TRAIL / ACTIVE branch for the rest of its
  // life, regardless of whether the live mark is currently above or
  // below entry. The engine itself doesn't close the trade until SL
  // fires, so the UI shouldn't ping-pong between "trailing" and "yellow
  // climbing" when mark oscillates around entry by a few cents.
  const greenWithPeak = inGreenZone && peakValid
  const peakP = peakValid ? (mfePxPeak as number) : entry

  // ───── Three display modes inside the GREEN zone ─────────────────────
  //  PRE-TRAIL  (no peak data — engine hasn't generated MFE yet) :
  //     - Bar domain    : entry (0%) → peak (100%)
  //     - Fill          : current mark's position in [entry, peak]
  //     - No trail mark — there isn't one yet
  //     - Caption       : "Peaked at $X · Y.YY% off peak"
  //
  //  PROJECTED  (synthetic trail from API; engine hasn't yet committed) :
  //     - Bar domain    : SAME as ACTIVE (trail at 20%, peak at 100%)
  //     - Fill          : current mark's position in that scaled domain
  //     - Trail mark    : DASHED, pinned at 20% — honest signal that the
  //                       engine hasn't locked yet
  //     - Caption       : "Projected · arms in Y min"
  //
  //  ACTIVE  (engine.trailFloor committed) :
  //     - Bar domain    : trail at 20%, peak at 100%, 0%=trail−(peak−trail)×0.25
  //     - Fill          : current mark's position in that scaled domain
  //     - Trail mark    : SOLID, pinned at 20%
  //     - Caption       : "Trailing · Y.YY% to take profit"  (mark→trail %)
  // ──────────────────────────────────────────────────────────────────────
  const activeTrail = greenWithPeak && engineTrailValid && !!trailFloorCommitted
  const projectedTrail = greenWithPeak && engineTrailValid && !trailFloorCommitted
  const inTrailZone = activeTrail || projectedTrail

  // Re-render once a minute so the "arms in Y min" countdown ticks down
  // even when the ticker is quiet (low-liquidity hours, ws dropout). The
  // mark-driven render normally handles this every few seconds via
  // useThrottledValue above, but we don't want the caption to freeze.
  const [, bumpClock] = useState(0)
  useEffect(() => {
    if (!projectedTrail) return
    const id = setInterval(() => bumpClock(n => n + 1), 30_000)
    return () => clearInterval(id)
  }, [projectedTrail])

  let fillPct = 0
  let fillClass = 'adm-meter-fill-red'
  let distToTPPct = 0  // ACTIVE only — headroom from mark to trail

  if (inTrailZone) {
    // ACTIVE or PROJECTED — same scaled geometry. The trailFloor value
    // is either engine-committed or API-synthesized; the math is identical.
    const trailP = trailFloor as number
    const peakToTrail = side === 'LONG' ? peakP - trailP : trailP - peakP
    const pricePerSlot = peakToTrail / (100 - TRAIL_MARK_PCT)  // price units per visual %
    if (pricePerSlot > 0) {
      const bottomPx = side === 'LONG'
        ? trailP - pricePerSlot * TRAIL_MARK_PCT
        : trailP + pricePerSlot * TRAIL_MARK_PCT
      const fromBottom = side === 'LONG' ? stableMark - bottomPx : bottomPx - stableMark
      fillPct = Math.max(0, Math.min(100, fromBottom / pricePerSlot))
    }
    distToTPPct = side === 'LONG'
      ? ((stableMark - trailP) / stableMark) * 100
      : ((trailP - stableMark) / stableMark) * 100
    fillClass = 'adm-meter-fill-pos'
  } else if (greenWithPeak) {
    // PRE-TRAIL — entry→peak progression. Fill = where mark sits.
    const range = side === 'LONG' ? peakP - entry : entry - peakP
    if (range > 0) {
      const fromEntry = side === 'LONG' ? stableMark - entry : entry - stableMark
      fillPct = Math.max(0, Math.min(100, (fromEntry / range) * 100))
    }
    fillClass = 'adm-meter-fill-pos'
  } else if (inProfit && inGreenZone) {
    // Green zone but no peak (cold start) — solid pos fill.
    fillPct = 100
    fillClass = 'adm-meter-fill-pos'
  } else if (inProfit) {
    // YELLOW — climbing toward the arming threshold.
    fillPct = Math.min(100, (movePct / ARM_PCT) * 100)
    fillClass = 'adm-meter-fill-yellow'
  } else {
    // RED — in loss, fill grows as cushion shrinks.
    const consumed = Math.max(0, SL_BASE_PCT - cushion)
    fillPct = Math.min(100, (consumed / SL_BASE_PCT) * 100)
  }

  // ───── Caption (live precision, mono digits hold width stable) ──────
  // All caption numbers derive from `stableMark` (the same 750ms-throttled
  // mark feeding the bar) so the text and the bar advance together. Two
  // decimal places — what the user actually wants to see ("0.12% to start
  // trailing", "1.21% to Stop Loss"). Width is held by tabular-nums on
  // .lt-num spans, so digit changes never shift surrounding glyphs.
  const offPeakPct = greenWithPeak && !inTrailZone && peakP > 0
    ? (side === 'LONG' ? ((peakP - stableMark) / peakP) * 100 : ((stableMark - peakP) / peakP) * 100)
    : 0

  const fmtPxLocal = (n: number) => {
    if (!Number.isFinite(n) || n <= 0) return '—'
    if (n >= 1000) return '$' + Math.round(n).toLocaleString('en-US')
    if (n >= 10) return '$' + n.toFixed(2)
    return '$' + n.toFixed(4)
  }

  let captionContent: React.ReactNode
  let captionClass = ''
  if (isPastSL) {
    captionContent = 'Stop loss triggered'
    captionClass = 'neg-text'
  } else if (activeTrail && distToTPPct > 0) {
    captionContent = (
      <>
        <IconShieldCheck size={11} />{' '}
        Trailing · <span className="lt-num">{distToTPPct.toFixed(2)}%</span> to take profit
      </>
    )
    captionClass = 'lt-pulse-text-locked'
  } else if (activeTrail) {
    captionContent = (<><IconShieldCheck size={11} />{' '}Take Profit Armed</>)
    captionClass = 'lt-pulse-text-locked'
  } else if (projectedTrail) {
    // Mirrors strategy.js DYN_TIERS — peak must hold for the tier's
    // reprieveMin before the engine commits a real trailFloor.
    const REPRIEVE_TIERS = [
      { mfe: 1.5, reprieveMin: 90 },
      { mfe: 3.0, reprieveMin: 120 },
      { mfe: 5.0, reprieveMin: 180 },
      { mfe: 8.0, reprieveMin: 240 },
    ]
    const mfePctSafe = typeof mfePct === 'number' ? mfePct : 0
    const tier = [...REPRIEVE_TIERS].reverse().find(t => mfePctSafe >= t.mfe) || REPRIEVE_TIERS[0]
    const peakAgeMin = typeof mfePeakTs === 'number' && Number.isFinite(mfePeakTs)
      ? Math.max(0, (Date.now() - mfePeakTs) / 60_000)
      : 0
    const armsInMin = Math.max(0, Math.ceil(tier.reprieveMin - peakAgeMin))
    captionContent = armsInMin > 0
      ? (<>Projected · arms in <span className="lt-num">{armsInMin}</span> min</>)
      : (<>Projected · arms within 1 min</>)
  } else if (greenWithPeak) {
    // PRE-TRAIL: peak price (only changes on new high) + live off-peak %.
    captionContent = (
      <>
        <IconShieldCheck size={11} />{' '}
        Peaked at <span className="lt-num">{fmtPxLocal(peakP)}</span>
        {' · '}<span className="lt-num">{offPeakPct.toFixed(2)}%</span> off peak
      </>
    )
    captionClass = 'lt-pulse-text-locked'
  } else if (inProfit && inGreenZone) {
    captionContent = (<><IconShieldCheck size={11} />{' '}Take Profit Armed</>)
    captionClass = 'lt-pulse-text-locked'
  } else if (inProfit) {
    const togo = Math.max(0, ARM_PCT - movePct)
    captionContent = (<><span className="lt-num">{togo.toFixed(2)}%</span> to start Take Profit Trailing</>)
  } else if (isCritical) {
    captionContent = (<>Stop loss approaching · <span className="lt-num">{cushion.toFixed(2)}%</span> left</>)
    captionClass = 'neg-text'
  } else {
    captionContent = (<><span className="lt-num">{cushion.toFixed(2)}%</span> to Stop Loss</>)
  }

  // Tooltip — entry + signed move only (no strategy mechanics).
  const entryLabel = entry < 10 ? entry.toFixed(4) : entry.toFixed(2)
  const tooltip = `Entry $${entryLabel} · move ${movePct >= 0 ? '+' : ''}${movePct.toFixed(2)}%`

  const barClasses = ['adm-meter-bar', 'lt-sl-bar']
  if (isCritical) barClasses.push('lt-sl-bar-critical')
  if (inProfit && inGreenZone) barClasses.push('lt-sl-bar-locked')

  // ───── Prices row (ACTIVE + PROJECTED — peak + trail; PRE-TRAIL puts
  //       peak price inside the caption, so the prices row is redundant) ─
  let pricesLine: React.ReactNode = null
  if (inTrailZone) {
    pricesLine = (
      <div className="lt-sl-prices">
        Peak <span className="lt-num">{fmtPxLocal(peakP)}</span>
        {' · '}Trail <span className="lt-num">{fmtPxLocal(trailFloor as number)}</span>
      </div>
    )
  }

  return (
    <div className="lt-sl-cell" title={tooltip}>
      <div className={barClasses.join(' ')}>
        <div className={'adm-meter-fill ' + fillClass} style={{ width: fillPct + '%' }} />
        {/* Trail mark rendered in ACTIVE (solid) or PROJECTED (dashed).
            PRE-TRAIL has no trail to render — caption shows off-peak %
            instead. */}
        {inTrailZone && (
          <div
            className={projectedTrail ? 'lt-trail-mark lt-trail-mark-projected' : 'lt-trail-mark'}
            style={{ left: TRAIL_MARK_PCT + '%' }}
          />
        )}
      </div>
      <div className={'lt-sl-text ' + captionClass}>{captionContent}</div>
      {pricesLine}
    </div>
  )
}

/**
 * Cfg-aware progress cell — replacement for SLDangerCell when Phase H
 * cfgDims are available. Different from SLDangerCell because the legacy
 * version hardcodes 1.5% trail activation + 4% SL across all trades,
 * which is correct only for ~50% of the basket. This version reads the
 * actual cfg's trail_mode + breakeven_at_R + strong_alert_gate +
 * tp_overbought/oversold + sl_type + sl_pct and selects the phase logic
 * per archetype (A_TRAIL_ONLY / B_TRAIL_PLUS_BE / C_BE_ONLY /
 * D_RSI_SL_ONLY). See lib/cfg-progress.ts + the audit doc at
 * docs/PROGRESS_BAR_CFG_AWARE_DESIGN.md.
 *
 * Tooltips: every term is hoverable via native `title` (Chris-requested
 * tooltip infrastructure). Phase 4 follow-up could replace these with a
 * styled Tooltip component, but `title` is the lightest first cut and
 * already gives customers the educational hover-to-learn pattern.
 */
function CfgProgressCell({
  cfgDims, entry, mark, side,
}: {
  cfgDims: CfgDims
  entry: number
  mark: number | null
  side: 'LONG' | 'SHORT'
}) {
  // Throttle high-frequency Bitget WS ticks down to the same 750ms cadence
  // SLDangerCell uses, so the bar + caption update smoothly without jitter.
  const stableMark = useThrottledValue(mark ?? entry, 750)

  if (!Number.isFinite(entry) || entry <= 0 || mark == null || !Number.isFinite(mark) || mark <= 0) {
    return <span style={{ color: 'var(--muted)' }}>—</span>
  }

  const state: ProgressBarState | null = computeProgressBarState({
    cfg: cfgDims,
    side,
    entryPx: entry,
    slPx: cfgDims.sl_price,
    mfePct: cfgDims.mfe_pct,
    beMovedFromState: cfgDims.be_moved,
    currentPx: stableMark,
  })

  if (!state) {
    return <span style={{ color: 'var(--muted)' }}>—</span>
  }

  // Map ProgressBarState → CSS classes that match the existing SLDangerCell
  // visual language (red/yellow/green meter bar). Gold accent on badges is
  // additive on top.
  const fillClass =
    state.phase === 'red'    ? 'lt-sl-fill-critical' :
    state.phase === 'yellow' ? 'lt-sl-fill-warn' :
    state.phase === 'green'  ? 'lt-sl-fill-armed' :
    'lt-sl-fill-warn'
  const barClasses = ['adm-meter-bar', 'lt-sl-bar']
  if (state.phase === 'red' && state.flash) barClasses.push('lt-sl-bar-critical')
  if (state.phase === 'green')              barClasses.push('lt-sl-bar-locked')

  // Tooltips — each technical term gets hover-to-learn educational text.
  // Keep concise; user can read deeper docs in the future.
  const TOOLTIPS = {
    trailing: 'Trailing TP follows price upward, locks in profit as MFE grows. Exit fires when price retraces from peak.',
    tier: 'Trail tightens at each MFE tier. Tier 1 starts at 1.5% MFE (60% retrace allowed). Tier 4 starts at 8% (only 30% retrace allowed).',
    retrace: 'If price gives back this percentage of MFE from peak, the trail exit fires.',
    strongAlert: 'A take-profit that fires on a strong-alert signal, but only if the cfg-specific gate condition is satisfied (e.g., MFE ≥ 2%).',
    mfe: 'Maximum Favorable Excursion — the peak profit reached at any point in this trade.',
    breakeven: 'Stop Loss has been moved to entry price. Position is locked against loss.',
    sl: 'Hard Stop Loss — the engine closes the position at this price to cap risk.',
    rsi: 'RSI-based Take Profit. Fires when the indicator hits the cfg-specific overbought/oversold threshold.',
  }
  const cellTitle = state.phase === 'red'
    ? TOOLTIPS.sl
    : state.label.includes('Trailing') ? TOOLTIPS.trailing
    : state.label.includes('Strong-alert') ? TOOLTIPS.strongAlert
    : state.label.includes('RSI') ? TOOLTIPS.rsi
    : TOOLTIPS.mfe

  return (
    <div className="lt-sl-cell" title={cellTitle}>
      <div className={barClasses.join(' ')}>
        <div className={'adm-meter-fill ' + fillClass} style={{ width: state.fillPct + '%' }} />
      </div>
      <div className={'lt-sl-text ' + (state.phase === 'red' ? 'lt-sl-text-critical' : state.phase === 'green' ? 'lt-sl-text-armed' : 'lt-sl-text-warn')}>
        {state.label}
      </div>
      {state.sublabel ? (
        <div className="lt-sl-prices" title={
          state.sublabel.includes('Tier')   ? TOOLTIPS.tier :
          state.sublabel.includes('retrace') ? TOOLTIPS.retrace :
          state.sublabel.includes('MFE')     ? TOOLTIPS.mfe :
          undefined
        }>
          {state.sublabel}
        </div>
      ) : null}
      {state.badges.length > 0 ? (
        <div className="lt-sl-badges">
          {state.badges.map((b, i) => (
            <span
              key={i}
              className={`lt-sl-badge lt-sl-badge-${b.kind}${b.pulse ? ' lt-sl-badge-pulse' : ''}`}
              title={
                b.kind === 'strong_alert_armed' ? TOOLTIPS.strongAlert :
                b.kind === 'be_moved'           ? TOOLTIPS.breakeven :
                undefined
              }
            >
              {b.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function LiveTradesTable({ title, rows, emptyText, pageSize = 50, lastColLabel = 'Reason' }: {
  title: string
  rows: LiveTradeRow[]
  emptyText: string
  pageSize?: number
  // Open Positions table renames the trailing column to "SL Danger" (where
  // the SLDangerCell meter lives). Trade History keeps the default "Reason"
  // since closed rows just show the literal exit reason text.
  lastColLabel?: string
}) {
  const [page, setPage] = useState(0)
  const [coin, setCoin] = useState<CoinFilter>('ALL')
  const [side, setSide] = useState<SideFilter>('ALL')

  const filtered = useMemo(() => rows.filter(r => {
    if (coin !== 'ALL' && !(r.symbol || '').startsWith(coin)) return false
    if (side === 'LONG' && r.side !== 'LONG') return false
    if (side === 'SHORT' && r.side !== 'SHORT') return false
    return true
  }), [rows, coin, side])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const cur = Math.min(page, totalPages - 1)
  const start = cur * pageSize
  const slice = filtered.slice(start, start + pageSize)

  const fmt$ = (n: number) => `${n >= 0 ? '+' : ''}$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`

  // Show the colour-key only on OPEN POSITIONS (where the Pulse meter
  // lives). TRADE HISTORY rows render the literal exit reason text in
  // the trailing column — no need for the legend there.
  const showPulseLegend = title === 'OPEN POSITIONS'

  return (
    <div className="card card-pad">
      <div className="bt-card-head">
        <div className="bt-card-title"><span className="bt-card-bar" /> {title}</div>
        {showPulseLegend && (
          <div className="lt-pulse-legend" aria-label="Pulse colour key">
            <span className="lt-pulse-key"><span className="lt-pulse-swatch lt-pulse-swatch-red" />Losing</span>
            <span className="lt-pulse-key"><span className="lt-pulse-swatch lt-pulse-swatch-yellow" />Winning</span>
            <span className="lt-pulse-key"><span className="lt-pulse-swatch lt-pulse-swatch-green" />Trailing</span>
          </div>
        )}
      </div>

      <div className="bt-trades-filters">
        <div className="bt-filter-group">
          <span className="bt-filter-label">Pair</span>
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
                    <img src={ASSET_LOGOS[sym]} alt="" style={{ width: 14, height: 14, borderRadius: '50%', marginRight: 6, verticalAlign: 'middle' }} />
                  ) : null}
                  {c}
                </button>
              )
            })}
          </div>
        </div>
        <div className="bt-filter-group">
          <span className="bt-filter-label">Side</span>
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

      <div className="table-scroll lt-table-wrap">
        {/* table-layout: fixed + explicit col widths = column widths never
            shift when decimal precision or sign changes (no flicker). All
            numeric cells already use .num (tabular-nums) so within-cell
            digit width is also stable.
            On mobile (≤768px), `.lt-table-wrap` is hidden via stax-design.css
            and the sibling `.lt-cards` block below renders one card per
            trade instead. Card layout duplicates the same data in a
            stacked structure so all 9 desktop columns fit a narrow phone
            viewport without horizontal scroll. */}
        <table style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            {/* 2026-05-26: switched from fixed em widths + flex-last to
                proportional percentages summing to 100%. Old layout left
                the last column (Pulse/Reason) ~40-60% of a wide desktop
                viewport because all other columns had absolute em widths
                — gave the "EXIT/P&L/% clustered left, Pulse floating far
                right" appearance Chris flagged. Proportional widths put
                each cell where eye expects it across all screen sizes.
                Pulse keeps a slightly higher share since the SL-danger
                meter is wider than a text cell. */}
            <col style={{ width: '4%' }} />        {/* # */}
            <col style={{ width: '12%' }} />       {/* Pair */}
            <col style={{ width: '7%' }} />        {/* Side */}
            <col style={{ width: '11%' }} />       {/* Size */}
            <col style={{ width: '13%' }} />       {/* Entry */}
            <col style={{ width: '13%' }} />       {/* Exit */}
            <col style={{ width: '10%' }} />       {/* P&L */}
            <col style={{ width: '8%' }} />        {/* % */}
            <col style={{ width: '22%' }} />       {/* Pulse/Reason */}
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>Pair</th>
              <th>Side</th>
              <th>Size</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>P&amp;L</th>
              <th>%</th>
              <th>{lastColLabel}</th>
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)' }}>
                {rows.length === 0 ? emptyText : 'No trades match these filters.'}
              </td></tr>
            ) : slice.map((r, i) => {
              const idx = filtered.length - (start + i)
              const logo = ASSET_LOGOS[r.symbol]
              const rowClass = r.open ? 'bt-trade-open' : (r.pnl > 0 ? 'bt-trade-win' : 'bt-trade-loss')
              const baseSym = (r.symbol || '').replace('USDT', '')
              const units = r.entryPx > 0 ? r.notional / r.entryPx : 0
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
                      <span className="num">{r.symbol}</span>
                    </div>
                  </td>
                  <td><span className={'badge ' + (r.side === 'LONG' ? 'badge-long' : 'badge-short')}>{r.side}</span></td>
                  <td className="num bt-price-cell">
                    ${r.notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    <span className="sub">{fmtUnits(units, baseSym)}</span>
                  </td>
                  <td className="num bt-price-cell">
                    {r.entryPx > 0 ? `$${r.entryPx.toFixed(r.entryPx < 10 ? 4 : 2)}` : '—'}
                    {r.entryTs ? <span className="ts">{fmtTradeTs(r.entryTs)}</span> : null}
                  </td>
                  <td className="num bt-price-cell">
                    {r.open ? (
                      <span className="bt-open-label"><span className="dot" />OPEN</span>
                    ) : r.exitPx != null ? (
                      <>
                        ${r.exitPx.toFixed(r.exitPx < 10 ? 4 : 2)}
                        {r.exitTs ? <span className="ts">{fmtTradeTs(r.exitTs)}</span> : null}
                      </>
                    ) : '—'}
                  </td>
                  <td className={'num ' + (r.pnl > 0 ? 'pos-text' : 'neg-text')}>{fmt$(r.pnl)}</td>
                  <td className={'num ' + (r.pnl > 0 ? 'pos-text' : 'neg-text')}>{r.pnlPct.toFixed(2)}%</td>
                  <td>
                    {r.open
                      ? (r.cfgDims
                          ? <CfgProgressCell
                              cfgDims={r.cfgDims}
                              entry={r.entryPx}
                              mark={r.markPx ?? null}
                              side={r.side}
                            />
                          : <SLDangerCell
                              entry={r.entryPx}
                              mark={r.markPx ?? null}
                              side={r.side}
                              mfePct={r.mfePct}
                              mfePxPeak={r.mfePxPeak}
                              tpArmed={r.tpArmed}
                              trailFloor={r.trailFloor}
                              trailFloorCommitted={r.trailFloorCommitted}
                              mfePeakTs={r.mfePeakTs}
                            />)
                      : <span className="num" style={{ color: 'var(--muted)' }}>{r.reason || '—'}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile-only stacked card layout. Same data set (`slice`), same
          pagination — only the markup differs. CSS toggles between the
          table above and these cards at ≤768px. Each card is one trade:
          pair badge + index header → entry/exit/size rows → PnL bar →
          (open trades) full-width Pulse meter or (closed) reason text. */}
      <div className="lt-cards">
        {slice.length === 0 ? (
          <div className="lt-cards-empty">{rows.length === 0 ? emptyText : 'No trades match these filters.'}</div>
        ) : slice.map((r, i) => {
          const idx = filtered.length - (start + i)
          const logo = ASSET_LOGOS[r.symbol]
          const baseSym = (r.symbol || '').replace('USDT', '')
          const units = r.entryPx > 0 ? r.notional / r.entryPx : 0
          const pnlClass = r.pnl > 0 ? 'pos-text' : 'neg-text'
          return (
            <div key={'card-' + (start + i)} className={'lt-card ' + (r.open ? 'lt-card-open' : (r.pnl > 0 ? 'lt-card-win' : 'lt-card-loss'))}>
              <div className="lt-card-head">
                <div className="lt-card-pair">
                  {logo ? (
                    <span className="lt-card-logo"><img src={logo} alt="" /></span>
                  ) : null}
                  <span className="num lt-card-sym">{r.symbol}</span>
                  <span className={'badge ' + (r.side === 'LONG' ? 'badge-long' : 'badge-short')}>{r.side}</span>
                </div>
                <span className="lt-card-idx">#{idx}</span>
              </div>

              <div className="lt-card-grid">
                <div className="lt-card-row">
                  <span className="lt-card-label">Entry</span>
                  <span className="num lt-card-val">
                    {r.entryPx > 0 ? `$${r.entryPx.toFixed(r.entryPx < 10 ? 4 : 2)}` : '—'}
                    {r.entryTs ? <span className="lt-card-ts">{fmtTradeTs(r.entryTs)}</span> : null}
                  </span>
                </div>
                <div className="lt-card-row">
                  <span className="lt-card-label">Size</span>
                  <span className="num lt-card-val">
                    ${r.notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    <span className="lt-card-ts">{fmtUnits(units, baseSym)}</span>
                  </span>
                </div>
                {!r.open && r.exitPx != null ? (
                  <div className="lt-card-row">
                    <span className="lt-card-label">Exit</span>
                    <span className="num lt-card-val">
                      ${r.exitPx.toFixed(r.exitPx < 10 ? 4 : 2)}
                      {r.exitTs ? <span className="lt-card-ts">{fmtTradeTs(r.exitTs)}</span> : null}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="lt-card-pnl">
                {r.open ? <span className="bt-open-label"><span className="dot" />OPEN</span> : null}
                <span className={'num ' + pnlClass}>{fmt$(r.pnl)}</span>
                <span className={'num ' + pnlClass}>{r.pnlPct.toFixed(2)}%</span>
              </div>

              <div className="lt-card-last">
                {r.open
                  ? (r.cfgDims
                      ? <CfgProgressCell
                          cfgDims={r.cfgDims}
                          entry={r.entryPx}
                          mark={r.markPx ?? null}
                          side={r.side}
                        />
                      : <SLDangerCell
                          entry={r.entryPx}
                          mark={r.markPx ?? null}
                          side={r.side}
                          mfePct={r.mfePct}
                          mfePxPeak={r.mfePxPeak}
                          tpArmed={r.tpArmed}
                          trailFloor={r.trailFloor}
                          trailFloorCommitted={r.trailFloorCommitted}
                          mfePeakTs={r.mfePeakTs}
                        />)
                  : <span className="lt-card-reason">{r.reason || '—'}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {totalPages > 1 && (
        <div className="bt-pagination">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={cur === 0} className="settings-btn-secondary">‹ Prev</button>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{cur + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={cur >= totalPages - 1} className="settings-btn-secondary">Next ›</button>
        </div>
      )}
    </div>
  )
}

// ─── Empty/error state ──────────────────────────────────────────────────────

function CenterMessage({ title, body, action }: { title: string; body: string; action?: { label: string; href: string } }) {
  return (
    <div style={{ padding: '64px 24px', textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>{title}</h2>
      <p style={{ marginTop: 8, fontSize: 14, color: 'var(--muted)' }}>{body}</p>
      {action ? (
        <a href={action.href} style={{
          marginTop: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: '8px 16px', borderRadius: 8,
          border: '1px solid rgba(212,160,23,0.35)', background: 'rgba(212,160,23,0.08)',
          color: 'var(--gold)', fontSize: 13, fontWeight: 600, textDecoration: 'none',
        }}>{action.label}</a>
      ) : null}
    </div>
  )
}
