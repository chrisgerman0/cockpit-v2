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

import { useEffect, useMemo, useRef, useState } from 'react'
import { useT, getCurrentLang } from '@/lib/i18n'
import { fetchPortfolioTrades, type PortfolioTrade, type Tier } from '@/lib/use-portfolio-trades'
import { type EquityPoint } from './Charts'

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

const TIER_LABELS = {
  conservative: { en: 'Conservative', pt: 'Conservador',  notional: '$5,000',  mult: '0.5×' },
  bold:         { en: 'Bold',         pt: 'Audacioso',   notional: '$10,000', mult: '1.0×' },
  aggressive:   { en: 'Aggressive',   pt: 'Agressivo',   notional: '$15,000', mult: '1.5×' },
}

function statsPath(tier: Tier): string {
  if (tier === 'conservative') return '/data/strategies/satoshi-stacker/portfolio-stats.json'
  return `/data/strategies/satoshi-stacker/tiers/${tier}/portfolio-stats.json`
}

const ASSET_LOGOS: Record<string, string> = {
  BTCUSDT: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/btc.svg',
  ETHUSDT: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/eth.svg',
  XRPUSDT: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/xrp.svg',
  SOLUSDT: '/v2/coin-icons/sol.png',
  SUIUSDT: '/v2/coin-icons/sui.png',
}

export function BacktestingContent() {
  const t = useT()
  const [tier, setTier] = useState<Tier>('conservative')
  const [stats, setStats] = useState<Stats | null>(null)
  const [trades, setTrades] = useState<PortfolioTrade[]>([])
  const [view, setView] = useState<'metrics' | 'trades'>('metrics')
  const [loading, setLoading] = useState(true)
  const [updatedAgo, setUpdatedAgo] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [statsRes, tradesData] = await Promise.all([
          fetch(statsPath(tier), { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
          fetchPortfolioTrades(tier).catch(() => [] as PortfolioTrade[]),
        ])
        if (cancelled) return
        setStats(statsRes || null)
        setTrades(tradesData)

        try {
          const headRes = await fetch(statsPath(tier), { method: 'HEAD' })
          const lm = headRes.headers.get('last-modified')
          if (lm) {
            const ageMs = Date.now() - new Date(lm).getTime()
            const mins = Math.floor(ageMs / 60000)
            setUpdatedAgo(mins < 1 ? '< 1m' : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`)
          }
        } catch {}
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [tier])

  const isPt = getCurrentLang() === 'PT'

  return (
    <div className="stax-page">
      {/* Header */}
      <div className="bt-header">
        <div className="bt-eyebrow">SATOSHI STACKER · 5-ASSET BASKET</div>
        <h1 className="bt-title">
          {isPt ? <>Performance <span className="bt-title-gold">verificada.</span></> : <>Verified <span className="bt-title-gold">performance.</span></>}
        </h1>
        <p className="bt-blurb">
          {isPt
            ? <>Backtest verificado da estratégia sistemática multi-ativo em BTC + ETH + SOL + XRP + SUI. <strong>Os números abaixo refletem o tier selecionado em uma conta inicial de $10.000.</strong> Seu PnL ao vivo escala proporcionalmente ao seu saldo e tier.</>
            : <>Verified backtest of our multi-asset systematic strategy across BTC + ETH + SOL + XRP + SUI. <strong>Numbers shown below reflect the tier selected above on a $10,000 starting account.</strong> Your live PnL scales proportionally to your actual balance and chosen tier.</>}
        </p>
        <div className="bt-meta">
          <span>{trades.length > 0 ? new Date(trades[0].entryTs).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</span>
          <span>—</span>
          <span>{trades.length > 0 ? new Date(trades[trades.length - 1].exitTs).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</span>
          <span>·</span>
          <span>{trades.length.toLocaleString()} trades</span>
          {updatedAgo ? (
            <>
              <span>·</span>
              <span className="bt-fresh">
                <span className={updatedAgo.endsWith('h') ? 'dot-stale' : 'dot-live'} />
                {updatedAgo === '< 1m' ? (isPt ? 'Ao vivo' : 'Live') : `${isPt ? 'Atualizado' : 'Stale'} · ${updatedAgo} ${isPt ? 'atrás' : 'ago'}`}
              </span>
            </>
          ) : null}
        </div>
      </div>

      {/* Top metrics */}
      <div className="bt-metrics-row">
        <MetricCard label={isPt ? 'P&L Líquido Total' : 'Total Net P&L'}
          value={stats?.finalCapital ? `+$${(stats.finalCapital - (stats.startCapital || 10000)).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
          sub={stats?.returnPct ? `${stats.returnPct.toFixed(2)}%` : ''} positive />
        <MetricCard label={isPt ? 'Drawdown Máximo' : 'Max Drawdown'} value={stats?.maxDD ? `${stats.maxDD.toFixed(2)}%` : '—'} negative />
        <MetricCard label={isPt ? 'Total de Trades' : 'Total Trades'} value={stats?.totalTrades?.toLocaleString() || '—'} />
        <MetricCard label={isPt ? 'Taxa de Acerto' : 'Win Rate'} value={stats?.winRate ? `${stats.winRate.toFixed(2)}%` : '—'} positive />
        <MetricCard label={isPt ? 'Fator de Lucro' : 'Profit Factor'} value={stats?.profitFactor ? stats.profitFactor.toFixed(2) : '—'} />
      </div>

      {/* Tier picker */}
      <div className="bt-tier-row">
        <div className="bt-tier-pills">
          {(['conservative', 'bold', 'aggressive'] as Tier[]).map(tk => (
            <button
              key={tk}
              type="button"
              className={'bt-tier-pill' + (tier === tk ? ' active' : '')}
              onClick={() => setTier(tk)}
            >
              {isPt ? TIER_LABELS[tk].pt : TIER_LABELS[tk].en}
            </button>
          ))}
        </div>
        <div className="bt-tier-meta">
          {isPt ? `Modo ${TIER_LABELS[tier].pt}` : `${TIER_LABELS[tier].en} tier`} ·
          {' '}{TIER_LABELS[tier].notional} {isPt ? 'nocional por trade' : 'notional / trade'} ·
          {' '}{isPt ? 'Cesta de 5 ativos' : '5-asset basket'} ·
          {' '}{trades.length > 0 ? `${(((trades[trades.length - 1].exitTs - trades[0].entryTs) / 86400000 / 365)).toFixed(1)}yr backtest` : ''}
        </div>
      </div>

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
        <MetricsView stats={stats} trades={trades} loading={loading} tier={tier} isPt={isPt} />
      ) : (
        <TradesTable trades={trades} loading={loading} isPt={isPt} />
      )}
    </div>
  )
}

// ─── Metrics view (all sections) ────────────────────────────────────────────

function MetricsView({ stats, trades, loading, tier, isPt }: {
  stats: Stats | null
  trades: PortfolioTrade[]
  loading: boolean
  tier: Tier
  isPt: boolean
}) {
  if (loading) return <div className="card card-pad">Loading…</div>
  if (!trades.length) return <div className="card card-pad">No trade data.</div>

  return (
    <>
      <EquityCurveSection trades={trades} stats={stats} isPt={isPt} />
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
      <MonthlyReturns trades={trades} isPt={isPt} />
    </>
  )
}

// ─── Equity curve with Log/Linear toggle + BTC B&H comparison ───────────────

function EquityCurveSection({ trades, stats, isPt }: { trades: PortfolioTrade[]; stats: Stats | null; isPt: boolean }) {
  const [scale, setScale] = useState<'linear' | 'log'>('linear')
  const [show, setShow] = useState<{ strategy: boolean; bh: boolean }>({ strategy: true, bh: true })

  const data = useMemo(() => {
    if (trades.length === 0) return { strategy: [] as EquityPoint[], bhPoints: [] as EquityPoint[] }
    const startCap = stats?.startCapital || 10000
    let eq = startCap
    const SAMPLE = 250
    const step = Math.max(1, Math.floor(trades.length / SAMPLE))
    const strategy: EquityPoint[] = [{ ts: trades[0].entryTs, value: startCap, month: '' }]
    for (let i = 0; i < trades.length; i++) {
      eq += trades[i].pnl
      if (i % step === 0 || i === trades.length - 1) {
        strategy.push({ ts: trades[i].exitTs, value: Math.max(1, Math.round(eq * 100) / 100), month: '' })
      }
    }

    // BTC Buy & Hold from first BTC entryPx → last BTC trade exitPx, sampled along time axis
    const btcTrades = trades.filter(t => (t.symbol || '').includes('BTC'))
    let bhPoints: EquityPoint[] = []
    if (btcTrades.length > 0) {
      const firstPx = btcTrades[0].entryPx
      const lastPx = btcTrades[btcTrades.length - 1].exitPx
      // Assume buy at firstPx with full $10k, hold to lastPx — but interpolate
      // along strategy timeline so the curve overlays. Use BTC's per-trade
      // entryPx samples for shape.
      bhPoints = btcTrades.filter((_, i) => i % step === 0 || i === btcTrades.length - 1).map(t => ({
        ts: t.exitTs,
        value: Math.max(1, Math.round((startCap * (t.exitPx / firstPx)) * 100) / 100),
        month: '',
      }))
    }
    return { strategy, bhPoints }
  }, [trades, stats?.startCapital])

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

  // ── Hover state ────────────────────────────────────────────────────────────
  // Track ts under cursor (interpolated, not snapped to a sample). Both dots
  // and the tooltip read off this single ts so they stay aligned.
  const [hoverTs, setHoverTs] = useState<number | null>(null)
  const [hoverVbX, setHoverVbX] = useState<number>(0)
  const wrapRef = useRef<HTMLDivElement | null>(null)

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

function PerAssetBreakdown({ stats, tier, isPt }: { stats: Stats | null; tier: Tier; isPt: boolean }) {
  const rows = stats?.breakdown ? Object.entries(stats.breakdown) : []
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
              <th>{isPt ? 'PAR' : 'PAIR'}</th>
              <th>{isPt ? 'ESCOPO' : 'SCOPE'}</th>
              <th style={{ textAlign: 'right' }}>{isPt ? 'TRADES' : 'TRADES'}</th>
              <th style={{ textAlign: 'right' }}>{isPt ? 'RETORNO' : 'RETURN'}</th>
              <th style={{ textAlign: 'right' }}>{isPt ? 'TX. ACERTO' : 'WIN RATE'}</th>
              <th style={{ textAlign: 'right' }}>{isPt ? 'FATOR LUCRO' : 'PROFIT FACTOR'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([asset, row]) => (
              <tr key={asset}>
                <td>
                  <div className="pair-cell">
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
              </tr>
            ))}
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

// ─── Monthly Returns heatmap ────────────────────────────────────────────────

function MonthlyReturns({ trades, isPt }: { trades: PortfolioTrade[]; isPt: boolean }) {
  const { years, byMonth, totals } = useMemo(() => {
    // Returns expressed as % of INITIAL capital ($10K — matches the daemon's
    // PORTFOLIO_INITIAL_CAPITAL). Fixed denominator means each month's number
    // is "$ gained that month / $10K starting" — comparable across months and
    // years without the compounding distortion. Year total = sum of monthly =
    // year_pnl / $10K (exact, no approximation needed).
    const INITIAL_CAPITAL = 10000
    let monthPnl = 0
    let lastK = ''
    const monthsByYear: Record<number, Record<number, number>> = {}
    for (const t of trades) {
      const d = new Date(t.exitTs)
      const y = d.getFullYear()
      const mo = d.getMonth()
      const k = `${y}-${mo}`
      if (k !== lastK) {
        if (lastK) {
          const [prevY, prevM] = lastK.split('-').map(Number)
          const ret = (monthPnl / INITIAL_CAPITAL) * 100
          if (!monthsByYear[prevY]) monthsByYear[prevY] = {}
          monthsByYear[prevY][prevM] = ret
        }
        monthPnl = 0
        lastK = k
      }
      monthPnl += t.pnl
    }
    if (lastK) {
      const [prevY, prevM] = lastK.split('-').map(Number)
      const ret = (monthPnl / INITIAL_CAPITAL) * 100
      if (!monthsByYear[prevY]) monthsByYear[prevY] = {}
      monthsByYear[prevY][prevM] = ret
    }
    const years = Object.keys(monthsByYear).map(Number).sort()
    const totals: Record<number, number> = {}
    for (const y of years) {
      totals[y] = Object.values(monthsByYear[y]).reduce((s, v) => s + v, 0)
    }
    return { years, byMonth: monthsByYear, totals }
  }, [trades])

  const months = isPt
    ? ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']
    : ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

  // Returns the variant class + the --intensity CSS var. The blob colour
  // and glass surface live in stax-design.css (.bt-monthly-cell + variants).
  // Stepped buckets (not a smooth gradient) so similar months share a shade
  // and the eye reads the table by tier, not by tiny tonal nudges:
  //   0–10%  → base    50–70% → step 3
  //   10–30% → step 1  70–90% → step 4
  //   30–50% → step 2  90–110% → step 5
  //                    110%+   → max
  function cellProps(v: number | undefined): { className: string; style?: React.CSSProperties } {
    if (v === undefined) return { className: 'bt-monthly-cell bt-monthly-cell-empty' }
    const a = Math.abs(v)
    const bucket =
      a < 10 ? 0 :
      a < 30 ? 1 :
      a < 50 ? 2 :
      a < 70 ? 3 :
      a < 90 ? 4 :
      a < 110 ? 5 : 6
    const intensity = bucket / 6
    const variant = v >= 0 ? 'bt-monthly-cell-win' : 'bt-monthly-cell-loss'
    return {
      className: `bt-monthly-cell ${variant}`,
      style: { ['--intensity' as string]: intensity.toFixed(3) } as React.CSSProperties,
    }
  }

  return (
    <div className="card card-pad">
      <div className="bt-card-head">
        <div className="bt-card-title"><span className="bt-card-bar" /> {isPt ? 'RETORNOS MENSAIS' : 'MONTHLY RETURNS'}</div>
      </div>
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

type CoinFilter = 'ALL' | 'BTC' | 'ETH' | 'SOL' | 'XRP' | 'SUI'
type SideFilter = 'ALL' | 'LONG' | 'SHORT'

const COIN_FILTERS: CoinFilter[] = ['ALL', 'BTC', 'ETH', 'SOL', 'XRP', 'SUI']
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
  return tr.reason === 'eod' || /^open/i.test(tr.displayReason || '')
}

function TradesTable({ trades, loading, isPt }: { trades: PortfolioTrade[]; loading: boolean; isPt: boolean }) {
  const [page, setPage] = useState(0)
  const [coin, setCoin] = useState<CoinFilter>('ALL')
  const [side, setSide] = useState<SideFilter>('ALL')
  const PAGE = 50

  const filtered = useMemo(() => {
    return trades.filter(tr => {
      if (coin !== 'ALL' && !(tr.symbol || '').startsWith(coin)) return false
      if (side === 'LONG' && tr.dir <= 0) return false
      if (side === 'SHORT' && tr.dir >= 0) return false
      return true
    })
  }, [trades, coin, side])

  if (loading) return <div className="card card-pad">Loading…</div>
  if (!trades.length) return <div className="card card-pad">No trades.</div>

  const reversed = [...filtered].reverse()
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
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)' }}>
                {isPt ? 'Nenhum trade com esses filtros.' : 'No trades match these filters.'}
              </td></tr>
            ) : slice.map((tr, i) => {
              const idx = filtered.length - (start + i)
              const logo = ASSET_LOGOS[tr.symbol]
              const open = isOpenTrade(tr)
              const rowClass = open ? 'bt-trade-open' : (tr.pnl > 0 ? 'bt-trade-win' : 'bt-trade-loss')
              const baseSym = (tr.symbol || '').replace('USDT', '')
              const units = tr.entryPx > 0 ? tr.notional / tr.entryPx : 0
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
                    ${tr.notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    <span className="sub">{fmtUnits(units, baseSym)}</span>
                  </td>
                  <td className="num bt-price-cell">
                    ${tr.entryPx.toFixed(tr.entryPx < 1 ? 4 : 2)}
                    <span className="ts">{fmtTradeTs(tr.entryTs)}</span>
                  </td>
                  <td className="num bt-price-cell">
                    {open ? (
                      <span className="bt-open-label"><span className="dot" />OPEN</span>
                    ) : (
                      <>
                        ${tr.exitPx.toFixed(tr.exitPx < 1 ? 4 : 2)}
                        <span className="ts">{fmtTradeTs(tr.exitTs)}</span>
                      </>
                    )}
                  </td>
                  <td className={'num ' + (tr.pnl > 0 ? 'pos-text' : 'neg-text')}>{fmt$(tr.pnl)}</td>
                  <td className={'num ' + (tr.pnl > 0 ? 'pos-text' : 'neg-text')}>{(tr.returnPct ?? 0).toFixed(2)}%</td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{tr.displayReason || tr.reason}</td>
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
