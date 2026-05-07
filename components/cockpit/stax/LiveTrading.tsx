'use client'

import { useMemo, useState } from 'react'
import './stax-design.css'
import { Icons } from './Icons'
import { useLiveTradingData, type LiveTradingData } from '@/lib/use-live-trading-data'
import { useT, getCurrentLang } from '@/lib/i18n'

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
  assetStates: (['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'SUIUSDT'] as const).map(symbol => ({
    sym: symbol.replace('USDT', '') as 'BTC' | 'ETH' | 'SOL' | 'XRP' | 'SUI',
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

  if (state.status === 'unauthenticated') return <CenterMessage title="Sign in to see live trading" body="Log in at staxs.ai to load your trading data." action={{ label: 'Go to login', href: '/login' }} />
  if (state.status === 'no-keys') return <CenterMessage title="Connect your Bitget account" body="Add API keys on staxs.ai/settings to see live positions." action={{ label: 'Connect API keys', href: '/settings' }} />
  if (state.status === 'no-bot') return <CenterMessage title="Bot not activated yet" body="Run the activation wizard to arm the bot." action={{ label: 'Open wizard', href: '/?setup=bot' }} />
  if (state.status === 'error') return <CenterMessage title="Couldn’t load live trading" body={state.message} />

  return <LiveTradingView data={state.data} />
}

function LiveTradingView({ data }: { data: LiveTradingData }) {
  // Open & closed rows both render through LiveTradesTable (a clone of the
  // backtesting List of Trades layout) so the live page reads as one
  // consistent surface — same columns, same coin/side filters, same row
  // tints, same OPEN pulsing label, same pagination.
  // Open positions = USER's actual Bitget positions (not strategy backtest state).
  // Source of truth: /api/trades-live → data.open. Same source the Dashboard page
  // uses, so both pages agree. assetStates (strategy view) is intentionally NOT
  // used here — it would surface the strategy's intended positions, which can
  // diverge from the user's actual exchange state (e.g., during catch-up windows
  // or when a trade fails to fill).
  const openRows: LiveTradeRow[] = useMemo(() =>
    data.open.map(t => ({
      symbol: t.pair,
      sym: t.sym,
      side: t.side,
      notional: t.sizeUsd,
      entryPx: t.entry,
      entryTs: t.openedAt ?? 0,
      exitPx: null,
      exitTs: null,
      pnl: t.pnlUsd,
      pnlPct: t.pnlPct,
      reason: t.pyramided ? 'Open · Pyramided' : 'Open',
      open: true,
    })),
    [data.open],
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
      <StatsRow totals={data.totals} unrealizedPnl={data.unrealizedPnl} />
      <LiveTradesTable
        title="OPEN POSITIONS"
        rows={openRows}
        emptyText="No open positions yet. Your next trade will appear here when a signal fires."
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

function StatsRow({ totals, unrealizedPnl }: { totals: LiveTradingData['totals']; unrealizedPnl: number }) {
  const realizedClass = totals.realizedPnl >= 0 ? 'pos' : 'neg'
  return (
    <div className="row row-stats">
      <Stat icon={Icons.Bars}    label="Total Trades"  value={String(totals.closedCount)} sub={totals.closedCount === 0 ? 'No history' : `Avg win ${fmtUsdSign(totals.avgWin)} · Avg loss ${fmtUsdSign(-totals.avgLoss)}`} />
      <Stat icon={Icons.TrendUp} label="Win Rate"      value={totals.closedCount === 0 ? '—' : `${totals.winRate}%`} sub={`${totals.wins} wins · ${totals.losses} losses`} />
      <Stat icon={Icons.Check}   label="Realized PnL"  value={totals.closedCount === 0 ? '$0' : fmtUsdSign(totals.realizedPnl)} sub={totals.closedCount === 0 ? 'No closed trades yet' : `Best ${fmtUsdSign(totals.bestTrade)} · Worst ${fmtUsdSign(totals.worstTrade)}`} valueClass={totals.closedCount === 0 ? '' : realizedClass} />
      <Stat icon={Icons.Star}    label="Total Return"  value={totals.closedCount === 0 ? '—' : fmtPctSign(totals.realizedPct)} sub="Since activation" valueClass={totals.closedCount === 0 ? '' : realizedClass} />
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
  sym: 'BTC' | 'ETH' | 'SOL' | 'XRP' | 'SUI'
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
}

const ASSET_LOGOS: Record<string, string> = {
  BTCUSDT: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/btc.svg',
  ETHUSDT: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/eth.svg',
  XRPUSDT: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/xrp.svg',
  SOLUSDT: '/v2/coin-icons/sol.png',
  SUIUSDT: '/v2/coin-icons/sui.png',
}

type CoinFilter = 'ALL' | 'BTC' | 'ETH' | 'SOL' | 'XRP' | 'SUI'
type SideFilter = 'ALL' | 'LONG' | 'SHORT'

const COIN_FILTERS: CoinFilter[] = ['ALL', 'BTC', 'ETH', 'SOL', 'XRP', 'SUI']
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

function LiveTradesTable({ title, rows, emptyText, pageSize = 50 }: {
  title: string
  rows: LiveTradeRow[]
  emptyText: string
  pageSize?: number
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

  return (
    <div className="card card-pad">
      <div className="bt-card-head">
        <div className="bt-card-title"><span className="bt-card-bar" /> {title}</div>
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

      <div className="table-scroll">
        <table>
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
              <th>Reason</th>
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
                    {r.entryPx > 0 ? `$${r.entryPx.toFixed(r.entryPx < 1 ? 4 : 2)}` : '—'}
                    {r.entryTs ? <span className="ts">{fmtTradeTs(r.entryTs)}</span> : null}
                  </td>
                  <td className="num bt-price-cell">
                    {r.open ? (
                      <span className="bt-open-label"><span className="dot" />OPEN</span>
                    ) : r.exitPx != null ? (
                      <>
                        ${r.exitPx.toFixed(r.exitPx < 1 ? 4 : 2)}
                        {r.exitTs ? <span className="ts">{fmtTradeTs(r.exitTs)}</span> : null}
                      </>
                    ) : '—'}
                  </td>
                  <td className={'num ' + (r.pnl > 0 ? 'pos-text' : 'neg-text')}>{fmt$(r.pnl)}</td>
                  <td className={'num ' + (r.pnl > 0 ? 'pos-text' : 'neg-text')}>{r.pnlPct.toFixed(2)}%</td>
                  <td className="num" style={{ color: 'var(--muted)' }}>{r.reason || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
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
