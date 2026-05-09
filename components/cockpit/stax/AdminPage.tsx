'use client'

/**
 * Admin cockpit — v2 design. Settings-style left sub-nav (220px) plus
 * 10 right-side panels:
 *
 *   Operations  →  Overview · Radar · Execution · Alerts · Risk · Users
 *   Business    →  Revenue · Wallets
 *   Research    →  Strategy · Social
 *
 * URL deep-link: /v2/admin?tab=<id> — mirrors the Settings pattern.
 *
 * Each panel is independent: lazy-loaded data via authedFetch, 30s auto-
 * refresh, empty-deps-array load() (avoids the ticker-loop bug from
 * memory/bug_v2_ticker_dep_loop.md). All panels reuse design-system
 * primitives (.card .card-pad, .bt-tier-pills, .badge, etc.) — no inline
 * hex, no transition: all, no border-radius: 999 on pills.
 *
 * Auth: panels call /api/admin/* endpoints which enforce role=admin via
 * Bearer token. Non-admins get 403; the panel surfaces a clear error.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { authedFetch } from '@/lib/api'
import { useIsAdmin } from '@/lib/use-is-admin'
import { Icons } from './Icons'
import {
  StrategyResearchPanel,
  SatoshiStackerSpecPanel,
  SignalComparisonPanel,
  ExecutionArchitecturePanel,
} from './AdminStrategyPanels'
import { SocialDispatchPanel, SocialGalleryPanel } from './AdminSocialPanels'

// ─── Local icons (admin-specific, kept inline so Icons.tsx stays cosmetic) ──

type IconProps = { size?: number }
const I = ({ size = 16, ...rest }: IconProps & React.SVGProps<SVGSVGElement>) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...rest} />
)
const People = (p: IconProps) => <I {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2 20c.6-3.5 3.4-5.5 7-5.5s6.4 2 7 5.5" /><circle cx="17" cy="8" r="3" /><path d="M22 19c-.4-2.4-2-4-4-4.5" /></I>
const Wallet = (p: IconProps) => <I {...p}><path d="M3 7h17a1 1 0 0 1 1 1v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Z" /><path d="M3 7V6a3 3 0 0 1 3-3h11v4" /><circle cx="17" cy="13" r="1" fill="currentColor" stroke="none" /></I>
const Receipt = (p: IconProps) => <I {...p}><path d="M5 3v18l3-2 3 2 3-2 3 2 3-2V3z" /><path d="M9 8h7M9 12h7M9 16h5" /></I>
const Dollar = (p: IconProps) => <I {...p}><path d="M12 2v20M16 6H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H8" /></I>
const Heart = (p: IconProps) => <I {...p}><path d="M3 12h3l2-5 4 10 2-5h7" /></I>
const Activity = (p: IconProps) => <I {...p}><path d="M3 12h4l3-9 4 18 3-9h4" /></I>
const Search = (p: IconProps) => <I {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></I>
const RefreshCw = (p: IconProps) => <I {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></I>
const Megaphone = (p: IconProps) => <I {...p}><path d="M3 11v2a2 2 0 0 0 2 2h2l8 5V4L7 9H5a2 2 0 0 0-2 2Z" /><path d="M19 8a4 4 0 0 1 0 8" /></I>
const ExternalLink = (p: IconProps) => <I {...p}><path d="M14 4h6v6M20 4l-9 9M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" /></I>

// ─── Tabs ───────────────────────────────────────────────────────────────────

type TabId =
  | 'overview' | 'radar' | 'execution' | 'alerts' | 'users'
  | 'revenue' | 'wallets' | 'strategy' | 'social'

type TabDef = { id: TabId; label: string; group: string; icon: React.ComponentType<IconProps> }

const TABS: TabDef[] = [
  { id: 'overview',  label: 'Overview',   group: 'Operations', icon: Icons.Grid },
  { id: 'radar',     label: 'Radar',      group: 'Operations', icon: Icons.Bolt },
  { id: 'execution', label: 'Execution',  group: 'Operations', icon: Icons.Signal },
  { id: 'alerts',    label: 'Alerts',     group: 'Operations', icon: Icons.Bell },
  { id: 'users',     label: 'Users',      group: 'Operations', icon: People },
  { id: 'revenue',   label: 'Revenue',    group: 'Business',   icon: Dollar },
  { id: 'wallets',   label: 'Wallets',    group: 'Business',   icon: Wallet },
  { id: 'strategy',  label: 'Strategy',   group: 'Research',   icon: Icons.Bars },
  { id: 'social',    label: 'Social',     group: 'Research',   icon: Megaphone },
]

const TAB_IDS: TabId[] = TABS.map(t => t.id) as TabId[]

// ─── Format helpers ────────────────────────────────────────────────────────

function fmtUsd(n: number | null | undefined, signed = false, dp = 0): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
  if (signed) return n >= 0 ? `+$${abs}` : `-$${abs}`
  return n < 0 ? `-$${abs}` : `$${abs}`
}
function fmtPx(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '—'
  // Tiered precision so the displayed value preserves the bps-level moves
  // that drive the % captions:
  //   ≥ 100  → integer (BTC $80,157 / ETH $2,312 — bps moves are big in $)
  //   ≥ 10   → 2dp     (SOL $91.62 — 1bp ≈ $0.009, 2dp covers it)
  //   < 10   → 4dp     (XRP $1.4242, SUI $0.9668 — 2dp would round away
  //                     ~1% of price action; the ETH/SOL %s wouldn't tally
  //                     with the displayed entry/mark on those rows.)
  if (n >= 100) return '$' + Math.round(n).toLocaleString('en-US')
  if (n >= 10) return '$' + n.toFixed(2)
  return '$' + n.toFixed(4)
}
function fmtPct(n: number | null | undefined, dp = 2, signed = true): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  const sign = signed ? (n >= 0 ? '+' : '') : ''
  return sign + n.toFixed(dp) + '%'
}
function fmtAge(iso?: string | number | null): string {
  if (!iso) return '—'
  const t = typeof iso === 'string' ? new Date(iso).getTime() : iso
  if (!Number.isFinite(t)) return '—'
  const ageMs = Date.now() - t
  if (ageMs < 60000) return Math.max(0, Math.floor(ageMs / 1000)) + 's ago'
  const ageMin = Math.floor(ageMs / 60000)
  if (ageMin < 60) return ageMin + 'm ago'
  const h = Math.floor(ageMin / 60)
  if (h < 24) return `${h}h ${ageMin % 60}m ago`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h ago`
}
function fmtMs(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return Math.round(ms) + 'ms'
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's'
  return Math.round(ms / 60000) + 'm'
}

// ─── Reusable components ───────────────────────────────────────────────────

function StatCard({ label, value, sub, tone }: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'pos' | 'neg' | 'gold' | 'muted'
}) {
  const valueStyle: React.CSSProperties = {}
  if (tone === 'pos') valueStyle.color = 'var(--pos)'
  if (tone === 'neg') valueStyle.color = 'var(--neg)'
  if (tone === 'gold') valueStyle.color = 'var(--gold)'
  return (
    <div className="card card-pad adm-stat">
      <div className="adm-stat-label">{label}</div>
      <div className="adm-stat-value num" style={valueStyle}>{value}</div>
      {sub != null && <div className="adm-stat-sub">{sub}</div>}
    </div>
  )
}

function SectionCard({ title, right, children }: {
  title: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="card card-pad">
      <div className="bt-card-head">
        <div className="bt-card-title"><span className="bt-card-bar" />{title}</div>
        {right}
      </div>
      {children}
    </div>
  )
}

function PageHeader({ eyebrow, lead, accent, blurb, refreshing, onRefresh }: {
  eyebrow: string
  lead: string
  accent: string
  blurb: string
  refreshing?: boolean
  onRefresh?: () => void
}) {
  return (
    <div className="bt-header" style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
      <div>
        <div className="bt-eyebrow">{eyebrow}</div>
        <h1 className="bt-title">
          {lead} <span className="bt-title-gold">{accent}</span>
        </h1>
        <p className="bt-blurb">{blurb}</p>
      </div>
      {onRefresh && (
        <button
          type="button"
          className="adm-icon-btn"
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh"
          aria-label="Refresh"
        >
          <span style={{ display: 'inline-flex', animation: refreshing ? 'adm-spin 1s linear infinite' : undefined }}>
            <RefreshCw size={16} />
          </span>
        </button>
      )}
    </div>
  )
}

function ErrorBox({ msg }: { msg: string | null }) {
  if (!msg) return null
  return (
    <div className="adm-error">{msg}</div>
  )
}

function EmptyBox({ children }: { children: React.ReactNode }) {
  return <div className="adm-empty">{children}</div>
}

function SubPills<T extends string>({ value, onChange, items }: {
  value: T
  onChange: (v: T) => void
  items: { id: T; label: string; count?: number | null }[]
}) {
  return (
    <div className="bt-tier-pills" style={{ marginBottom: 12 }}>
      {items.map(it => (
        <button
          key={it.id}
          type="button"
          className={'bt-tier-pill' + (value === it.id ? ' active' : '')}
          onClick={() => onChange(it.id)}
        >
          {it.label}{typeof it.count === 'number' ? ` · ${it.count}` : ''}
        </button>
      ))}
    </div>
  )
}

// ─── Hook: lazy auto-refresh data loader ───────────────────────────────────

function usePanelData<T>(
  active: boolean,
  fetcher: () => Promise<T>,
  intervalMs = 30_000,
  // Optional cache-key string. When it changes, the panel re-fetches
  // immediately (closure captures the latest fetcher). Use it for panels
  // with filter/search inputs whose URL changes — e.g. severity in Alerts,
  // search/page in Users. For static-URL panels (Overview, Radar, etc.),
  // omit it so the fetcher is called once on activation + on the interval.
  revalidateKey?: string,
) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const result = await fetcher()
        if (!cancelled) setData(result)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    const id = setInterval(() => {
      ;(async () => {
        try {
          const result = await fetcher()
          if (!cancelled) setData(result)
        } catch (e: any) {
          if (!cancelled) setError(e?.message || String(e))
        }
      })()
    }, intervalMs)
    return () => { cancelled = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, refreshTick, intervalMs, revalidateKey])

  return {
    data,
    loading,
    error,
    refresh: () => setRefreshTick(t => t + 1),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Top-level admin shell
// ────────────────────────────────────────────────────────────────────────────

export function AdminContent() {
  const search = useSearchParams()
  const router = useRouter()

  // Admin gate — redirect non-admins back to dashboard. The /api/admin/*
  // endpoints are independently protected server-side, so anyone hitting
  // /v2/admin without admin role gets 403 on every request anyway, but
  // bouncing them out is the right UX.
  const { isAdmin, loading: adminLoading } = useIsAdmin()
  useEffect(() => {
    if (!adminLoading && isAdmin === false) {
      window.location.href = '/v2/'
    }
  }, [adminLoading, isAdmin])

  const tabFromUrl = (search?.get('tab') || 'overview') as TabId
  const [tab, setTab] = useState<TabId>(TAB_IDS.includes(tabFromUrl) ? tabFromUrl : 'overview')

  useEffect(() => {
    const next = (search?.get('tab') || 'overview') as TabId
    if (TAB_IDS.includes(next) && next !== tab) setTab(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  function selectTab(id: TabId) {
    setTab(id)
    router.replace(`/admin?tab=${id}`, { scroll: false })
  }

  // Group tabs visually
  const grouped = useMemo(() => {
    const out: { group: string; tabs: TabDef[] }[] = []
    for (const t of TABS) {
      const g = out.find(x => x.group === t.group)
      if (g) g.tabs.push(t)
      else out.push({ group: t.group, tabs: [t] })
    }
    return out
  }, [])

  // While the admin check is in flight or has just rejected, render nothing
  // (the redirect effect above moves them off the page).
  if (adminLoading || isAdmin === false) {
    return <div className="adm-wrap" />
  }

  return (
    <div className="adm-wrap">
      <h1 className="settings-title">Admin</h1>
      <div className="adm-grid">
        <nav className="settings-nav adm-nav" aria-label="Admin navigation">
          {grouped.map((grp, gi) => (
            <div key={grp.group} style={gi > 0 ? { marginTop: 14 } : undefined}>
              <div className="adm-nav-group">{grp.group}</div>
              {grp.tabs.map(tb => {
                const Ico = tb.icon
                return (
                  <button
                    key={tb.id}
                    onClick={() => selectTab(tb.id)}
                    className={'settings-tab' + (tab === tb.id ? ' active' : '')}
                    type="button"
                  >
                    <Ico size={16} />
                    <span>{tb.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="settings-panel adm-panel">
          <div style={{ display: tab === 'overview' ? 'block' : 'none' }}>
            <OverviewPanel active={tab === 'overview'} />
          </div>
          <div style={{ display: tab === 'radar' ? 'block' : 'none' }}>
            <RadarPanel active={tab === 'radar'} />
          </div>
          <div style={{ display: tab === 'execution' ? 'block' : 'none' }}>
            <ExecutionPanel active={tab === 'execution'} />
          </div>
          <div style={{ display: tab === 'alerts' ? 'block' : 'none' }}>
            <AlertsPanel active={tab === 'alerts'} />
          </div>
          <div style={{ display: tab === 'users' ? 'block' : 'none' }}>
            <UsersPanel active={tab === 'users'} />
          </div>
          <div style={{ display: tab === 'revenue' ? 'block' : 'none' }}>
            <RevenuePanel active={tab === 'revenue'} />
          </div>
          <div style={{ display: tab === 'wallets' ? 'block' : 'none' }}>
            <WalletsPanel active={tab === 'wallets'} />
          </div>
          <div style={{ display: tab === 'strategy' ? 'block' : 'none' }}>
            <StrategyPanel active={tab === 'strategy'} />
          </div>
          <div style={{ display: tab === 'social' ? 'block' : 'none' }}>
            <SocialPanel active={tab === 'social'} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Overview panel
// ────────────────────────────────────────────────────────────────────────────

type OverviewData = {
  overview: {
    total_leads?: number
    total_subscribed?: number
    total_trial?: number
    total_connected?: number
    total_net_profit?: number
    total_volume?: number
  }
  open_positions: any[]
  critical_alerts: any[]
  last_signal: any
  recent_alerts: any[]
  recent_signups: any[]
  fetched_at: string
}

type SystemHealthData = {
  ts: number
  feed: { data: any; monitorAgeMs: number | null; missing: boolean }
  deadman: { data: any; monitorAgeMs: number | null; missing: boolean }
  recon: { data: any; monitorAgeMs: number | null; missing: boolean }
}

function OverviewPanel({ active }: { active: boolean }) {
  const ov = usePanelData<OverviewData>(active, () => authedFetch('/api/admin/overview'), 30_000)
  const sh = usePanelData<SystemHealthData>(active, () => authedFetch('/api/admin/system-health'), 30_000)

  const o = ov.data?.overview
  const opens = ov.data?.open_positions || []
  const recentAlerts = ov.data?.recent_alerts || []

  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="ADMIN · OVERVIEW"
        lead="Pipeline + business"
        accent="snapshot."
        blurb="Live counts, open positions, last signal, system health. Auto-refreshes every 30s."
        refreshing={ov.loading || sh.loading}
        onRefresh={() => { ov.refresh(); sh.refresh() }}
      />
      <ErrorBox msg={ov.error || sh.error} />

      {/* Tile row */}
      <div className="row row-stats">
        <StatCard label="Open positions" value={opens.length} tone={opens.length > 0 ? 'pos' : 'muted'} />
        <StatCard label="Pending fills" value={(o as any)?.tradesPending ?? '—'} />
        <StatCard label="Total users" value={(o?.total_leads ?? '—').toString()} />
        <StatCard label="Active subs" value={(o?.total_subscribed ?? '—').toString()} sub={`Trial ${o?.total_trial ?? '—'}`} />
      </div>
      <div className="row row-stats">
        <StatCard label="API connected" value={(o?.total_connected ?? '—').toString()} />
        <StatCard label="Net profit" value={fmtUsd(o?.total_net_profit ?? null, true)} tone={(o?.total_net_profit ?? 0) >= 0 ? 'pos' : 'neg'} />
        <StatCard label="Total volume" value={fmtUsd(o?.total_volume ?? null)} />
        <StatCard label="Critical alerts" value={(ov.data?.critical_alerts || []).length} tone={(ov.data?.critical_alerts || []).length > 0 ? 'neg' : 'muted'} />
      </div>

      {/* Feed health card */}
      <SectionCard
        title="FEED HEALTH"
        right={sh.data?.feed?.data ? (
          <span className="adm-eye">
            {(sh.data.feed.data.assets || []).length - ((sh.data.feed.data.stale || []).length || 0)} / {(sh.data.feed.data.assets || []).length} healthy · monitor {fmtAge(sh.data.feed.data.ts)}
          </span>
        ) : null}
      >
        {!sh.data?.feed?.data ? (
          <EmptyBox>feed-freshness-monitor not writing /tmp/staxs-feed-status.json — check PM2.</EmptyBox>
        ) : (
          <div className="adm-feed-grid">
            {(sh.data.feed.data.assets || []).map((a: any) => {
              const sym = a.symbol.replace('USDT', '')
              return (
                <div key={a.symbol} className={'adm-feed-cell' + (a.stale ? ' adm-feed-stale' : '')}>
                  <div className="adm-feed-head">
                    <span className={a.stale ? 'dot-stale' : 'dot-live'} />
                    <span className="num" style={{ fontWeight: 600 }}>{sym}</span>
                  </div>
                  <div className="adm-feed-meta">lag <span className="num">{a.lagPretty}</span></div>
                  <div className="adm-feed-meta sub">{a.lastIso ? a.lastIso.slice(11, 16) + 'Z' : 'no data'}</div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* Two-column: Last signal + Open positions */}
      <div className="bt-twin-row">
        <SectionCard title="LAST SIGNAL">
          {!ov.data?.last_signal ? (
            <EmptyBox>No signals executed yet.</EmptyBox>
          ) : (
            <div className="adm-kvlist">
              <div className="adm-kv"><span>Symbol</span><span className="num">{(ov.data.last_signal.signal_symbol || '—').replace('USDT', '/USDT')}</span></div>
              <div className="adm-kv"><span>Action</span>
                <span>
                  <span style={{ fontWeight: 600 }}>{(ov.data.last_signal.signal_action || '').split(' ')[0] || '—'}</span>
                  {' '}
                  {(() => {
                    const side = ((ov.data.last_signal.signal_action || '').split(' ')[1] || '').toUpperCase()
                    if (!side) return null
                    return <span className={'badge ' + (side === 'LONG' ? 'badge-long' : 'badge-short')}>{side}</span>
                  })()}
                </span>
              </div>
              {ov.data.last_signal.signal_price != null && (
                <div className="adm-kv"><span>Price</span><span className="num">{fmtPx(ov.data.last_signal.signal_price)}</span></div>
              )}
              {ov.data.last_signal.signal_sl_px != null && (
                <div className="adm-kv"><span>SL</span><span className="num neg-text">{fmtPx(ov.data.last_signal.signal_sl_px)}</span></div>
              )}
              {ov.data.last_signal.signal_reason && (
                <div className="adm-kv"><span>Reason</span><span className="num adm-mono-sm">{ov.data.last_signal.signal_reason}</span></div>
              )}
              <div className="adm-kv"><span>Status</span><span className="pos-text">{ov.data.last_signal.status || '—'}</span></div>
              <div className="adm-kv"><span>Users</span><span className="num">{ov.data.last_signal.total_users ?? '—'}</span></div>
              <div className="adm-kv"><span>When</span><span>{fmtAge(ov.data.last_signal.signal_timestamp)}</span></div>
              {ov.data.last_signal.signal_id && (
                <div className="adm-kv"><span>ID</span><span className="num adm-mono-sm">{ov.data.last_signal.signal_id}</span></div>
              )}
            </div>
          )}
        </SectionCard>

        <SectionCard title={`OPEN POSITIONS · ${opens.length}`}>
          {opens.length === 0 ? (
            <EmptyBox>No open positions.</EmptyBox>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th style={{ textAlign: 'right' }}>Entry</th>
                    <th style={{ textAlign: 'right' }}>Size</th>
                    <th style={{ textAlign: 'right' }}>PnL</th>
                    <th style={{ textAlign: 'right' }}>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {opens.map((p: any) => {
                    const pnl = Number(p.pnl_usd) || 0
                    const sideUp = (p.side || '').toUpperCase()
                    return (
                      <tr key={p.id}>
                        <td className="adm-truncate" style={{ maxWidth: 180 }}>{p.profile?.email || (p.user_id || '').slice(0, 8)}</td>
                        <td className="num">{p.symbol || '—'}</td>
                        <td>{sideUp ? <span className={'badge ' + (sideUp === 'LONG' ? 'badge-long' : 'badge-short')}>{sideUp}</span> : '—'}</td>
                        <td className="num" style={{ textAlign: 'right' }}>{fmtPx(p.entry_price)}</td>
                        <td className="num" style={{ textAlign: 'right' }}>{fmtUsd(p.size_usd)}</td>
                        <td className="num" style={{ textAlign: 'right' }}><span className={pnl >= 0 ? 'pos-text' : 'neg-text'}>{fmtUsd(pnl, true)}</span></td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtAge(p.opened_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      {recentAlerts.length > 0 && (
        <SectionCard title="RECONCILIATION ALERTS">
          <div className="adm-alert-list">
            {recentAlerts.slice(0, 8).map((a: any, i: number) => (
              <div key={i} className={'adm-alert ' + (a.severity === 'critical' ? 'adm-alert-crit' : 'adm-alert-warn')}>
                <span className="adm-alert-sev">{(a.severity || '').toUpperCase()}</span>
                <span>{a.description}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Radar panel — visualises the Telegram digest
// ────────────────────────────────────────────────────────────────────────────

type RadarData = {
  ts: number
  nextBarTs: number
  perfMs: number
  cached?: boolean
  account: {
    equity: number | null
    available: number | null
    unrealizedPL: number | null
    todayPnl: number
    todayCount: number
    strategyPnl: number
    drawdownPct: number
    peakEquity: number | null
  } | null
  assets: Array<{
    symbol: string
    sym: string
    price?: number
    hvn?: number | null
    bbW?: number
    bbWThresh?: number
    bbWPass?: boolean
    breakoutLong?: number
    breakoutShort?: number
    distToLongPct?: number | null
    distToShortPct?: number | null
    pos?: {
      dir: 'LONG' | 'SHORT'
      entry: number
      sl: number
      slDistPct: number
      mfePct: number
      mfePxPeak: number
      trailArmed: boolean
      togoPct: number
      trailFloor: number | null
      pyramidAdded: boolean
      notional: number
      bitgetActualEntry: number
      bitgetActualSize: number
      entryTs: number | null
    } | null
    engineLastTickAt?: string | null
    engineRuns?: number
    error?: string
  }>
  basket: { long: number; short: number; flat: number }
  closestToEntry: { sym: string; distPct: number; dir: 'below' | 'above' } | null
  health: any
}

const ASSET_LOGOS: Record<string, string> = {
  BTC: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/btc.svg',
  ETH: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/eth.svg',
  XRP: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/xrp.svg',
  SOL: '/v2/coin-icons/sol.png',
  SUI: '/v2/coin-icons/sui.png',
}

function nextBarLabel(nextBarTs: number) {
  const minsAway = Math.max(0, Math.round((nextBarTs - Date.now()) / 60000))
  const hh = new Date(nextBarTs).toISOString().slice(11, 16)
  return `${hh} UTC · in ${minsAway}m`
}

function RadarPanel({ active }: { active: boolean }) {
  const radar = usePanelData<RadarData>(active, () => authedFetch('/api/admin/radar'), 60_000)
  const r = radar.data

  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="SATOSHI STACKER · RADAR"
        lead="Live engine"
        accent="pulse."
        blurb="Per-asset state, MFE, breakout triggers, and account snapshot. Same data as the 4-hourly Telegram digest, refreshes every 60s."
        refreshing={radar.loading}
        onRefresh={radar.refresh}
      />
      <ErrorBox msg={radar.error} />

      {/* Hero strip — account top line */}
      <div className="row row-stats">
        <StatCard
          label="Today"
          value={r?.account ? fmtUsd(r.account.todayPnl, true) : '—'}
          sub={r?.account ? `${r.account.todayCount} closed` : null}
          tone={r?.account ? (r.account.todayPnl > 0 ? 'pos' : r.account.todayPnl < 0 ? 'neg' : 'muted') : undefined}
        />
        <StatCard
          label="Since live"
          value={r?.account ? fmtUsd(r.account.strategyPnl, true) : '—'}
          sub="V1 cutover · 7 May"
          tone={r?.account ? (r.account.strategyPnl > 0 ? 'pos' : r.account.strategyPnl < 0 ? 'neg' : 'muted') : undefined}
        />
        <StatCard
          label="Equity"
          value={r?.account?.equity != null ? fmtUsd(r.account.equity) : '—'}
          sub={r?.account?.available != null ? `Avail ${fmtUsd(r.account.available)}` : null}
        />
        <StatCard
          label="Drawdown"
          value={r?.account ? fmtPct(r.account.drawdownPct, 1, false) : '—'}
          sub={r?.account?.peakEquity != null ? `Peak ${fmtUsd(r.account.peakEquity)}` : null}
          tone={r?.account ? ((r.account.drawdownPct ?? 0) > 5 ? 'neg' : 'muted') : undefined}
        />
      </div>

      {/* Strategy banner */}
      <div className="adm-banner">
        <span className="bt-eyebrow" style={{ marginBottom: 0 }}>V1 STRATEGY</span>
        <span className="adm-banner-text">VolumeProfile breakout + per-asset BB-width gate · 5-asset basket (BTC/ETH/SOL/XRP/SUI) · next 4H bar {r ? nextBarLabel(r.nextBarTs) : '—'}</span>
      </div>

      {/* Per-asset cards */}
      <div className="adm-asset-grid">
        {r?.assets.map(a => <RadarAssetCard key={a.symbol} a={a} />)}
        {!r && [0, 1, 2, 3, 4].map(i => <div key={i} className="card card-pad adm-asset-skel" />)}
      </div>

      {/* Basket summary + closest-to-entry */}
      <div className="bt-twin-row">
        <SectionCard title="BASKET">
          {r ? (
            <div className="adm-basket-row">
              <div className="adm-basket-stat">
                <span className="adm-basket-num pos-text">{r.basket.long}</span>
                <span className="adm-basket-lab">long</span>
              </div>
              <div className="adm-basket-stat">
                <span className="adm-basket-num neg-text">{r.basket.short}</span>
                <span className="adm-basket-lab">short</span>
              </div>
              <div className="adm-basket-stat">
                <span className="adm-basket-num">{r.basket.flat}</span>
                <span className="adm-basket-lab">flat</span>
              </div>
              {r.closestToEntry && (
                <div className="adm-closest">
                  <div className="adm-closest-label">Closest to entry</div>
                  <div className="adm-closest-val">
                    <span className="num" style={{ fontWeight: 700, color: 'var(--gold)' }}>{r.closestToEntry.sym}</span>
                    <span className="adm-closest-meta">{r.closestToEntry.distPct.toFixed(2)}% {r.closestToEntry.dir} long breakout</span>
                  </div>
                </div>
              )}
            </div>
          ) : <EmptyBox>Loading…</EmptyBox>}
        </SectionCard>

        <SectionCard title="SYSTEM HEALTH">
          {r?.health ? (
            <div className="adm-health-row">
              <HealthChip name="deadman" h={r.health.deadman} />
              <HealthChip name="recon" h={r.health.recon} />
              <HealthChip name="feed" h={r.health.feed} />
            </div>
          ) : <EmptyBox>Loading…</EmptyBox>}
          {r && r.health?.recon?.details?.length > 0 && (
            <div className="adm-recon-details">
              {r.health.recon.details.map((d: string, i: number) => (
                <div key={i} className="adm-recon-line">{d}</div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Footer meta */}
      {r && (
        <div className="adm-footer-meta">
          Generated <span className="num">{new Date(r.ts).toISOString().slice(0, 19).replace('T', ' ')}Z</span>
          {' · '}fetched in <span className="num">{r.perfMs}ms</span>
          {r.cached ? <span className="adm-badge-cached"> cached</span> : null}
        </div>
      )}
    </div>
  )
}

function RadarAssetCard({ a }: { a: RadarData['assets'][number] }) {
  if (a.error) {
    return (
      <div className="card card-pad adm-asset adm-asset-err">
        <div className="adm-asset-head">
          <strong className="num">{a.sym}</strong>
          <span className="badge" style={{ background: 'rgba(255,77,79,0.15)', color: 'var(--neg)', border: '1px solid rgba(255,77,79,0.4)' }}>FETCH FAIL</span>
        </div>
        <div className="adm-asset-err-msg">{a.error}</div>
      </div>
    )
  }

  const pos = a.pos
  const stateClass = pos ? (pos.dir === 'LONG' ? 'adm-asset-long' : 'adm-asset-short') : 'adm-asset-flat'
  const stateLabel = pos ? pos.dir : 'FLAT'
  const stateBadge = pos ? (pos.dir === 'LONG' ? 'badge-long' : 'badge-short') : ''

  // Progress to trail tier 1 (capped at 1.5%)
  const tier1Target = 1.5
  const trailPct = pos ? Math.min(100, Math.max(0, (pos.mfePct / tier1Target) * 100)) : 0

  // Current unrealized PnL % — anchored to strategy entry, sign-flipped for
  // shorts. This is what the trade is doing RIGHT NOW; pos.mfePct is the
  // historical peak (very different number, common source of confusion).
  let currentPct = 0
  if (pos && a.price && pos.entry) {
    currentPct = pos.dir === 'LONG'
      ? ((a.price - pos.entry) / pos.entry) * 100
      : ((pos.entry - a.price) / pos.entry) * 100
  }

  // bbW progress (capped at 2× threshold for visual)
  const bbMax = (a.bbWThresh || 0) * 2
  const bbPct = a.bbW != null && bbMax > 0 ? Math.min(100, (a.bbW / bbMax) * 100) : 0

  return (
    <div className={'card card-pad adm-asset ' + stateClass}>
      <div className="adm-asset-head">
        <div className="adm-asset-headleft">
          <img src={ASSET_LOGOS[a.sym] || ''} alt={a.sym} className="adm-coin" />
          <strong className="num">{a.sym}</strong>
          <span className="adm-asset-price num">{fmtPx(a.price)}</span>
        </div>
        {pos ? (
          <span className={'badge ' + stateBadge}>{stateLabel}</span>
        ) : (
          <span className="badge adm-badge-flat">FLAT</span>
        )}
      </div>

      {pos ? (
        <>
          {/* Live unrealized PnL — shown in big text so it's instantly clear
              whether the trade is currently winning or losing. Computed
              against pos.entry (strategy's intended entry, same anchor the
              radar uses everywhere else). */}
          <div className="adm-asset-now">
            <span className="adm-asset-lab">Now</span>
            <span className={'adm-asset-now-val num ' + (currentPct >= 0 ? 'pos-text' : 'neg-text')}>
              {currentPct >= 0 ? '+' : ''}{currentPct.toFixed(2)}%
            </span>
          </div>

          <div className="adm-asset-grid3">
            <div>
              <div className="adm-asset-lab">Entry</div>
              <div className="adm-asset-val num">{fmtPx(pos.entry)}</div>
            </div>
            <div>
              <div className="adm-asset-lab">SL</div>
              <div className="adm-asset-val num neg-text">{fmtPx(pos.sl)}</div>
            </div>
            <div>
              <div className="adm-asset-lab">Mark</div>
              <div className="adm-asset-val num">{fmtPx(a.price)}</div>
            </div>
          </div>

          {/* Peak MFE — best favourable move since entry, NOT current PnL.
              Arms the dynamic trailing stop at +1.5%. Made the label
              explicit because "MFE" alone read like current PnL to admins
              new to the term. */}
          <div className="adm-asset-meter">
            <div className="adm-asset-meter-head">
              <span
                className="adm-asset-lab"
                title="Maximum Favorable Excursion — the best price the trade has reached since entry. Not current PnL. The dynamic trailing stop arms when this hits +1.5%."
              >
                Peak (MFE) · trail arms @ +1.5%
              </span>
              {/* Two-state sequence (matches /v2/live's Pulse):
                    yellow (winning) → green (profit locked).
                    No intermediate "armed" colour — collapsed into yellow. */}
              <span className="num">
                {pos.mfePct >= 0 ? '+' : ''}{pos.mfePct.toFixed(2)}%
                {(() => {
                  const lockedHere = pos.trailArmed
                    && pos.trailFloor != null
                    && Number.isFinite(pos.trailFloor)
                    && (pos.dir === 'LONG' ? pos.trailFloor > pos.entry : pos.trailFloor < pos.entry)
                  if (lockedHere) return <span className="pos-text"> · LOCKED</span>
                  if (pos.trailArmed) return ' · ARMED'
                  return ` · need +${pos.togoPct.toFixed(2)}%`
                })()}
              </span>
            </div>
            <div className="adm-meter-bar">
              {(() => {
                const lockedHere = pos.trailArmed
                  && pos.trailFloor != null
                  && Number.isFinite(pos.trailFloor)
                  && (pos.dir === 'LONG' ? pos.trailFloor > pos.entry : pos.trailFloor < pos.entry)
                const fillClass = lockedHere ? 'adm-meter-fill-pos' : 'adm-meter-fill-yellow'
                return (
                  <div
                    className={'adm-meter-fill ' + fillClass}
                    style={{ width: trailPct + '%' }}
                  />
                )
              })()}
            </div>
          </div>

          {/* SL danger meter — mirrors the MFE bar but in red. Fills as price
              consumes the entry's 4% SL cushion. Empty = full cushion (low
              risk). Full = SL hit (max risk). Visual answers "how close to
              stop-out?" at a glance. */}
          {(() => {
            const SL_BASE_PCT = 4
            const cushion = pos.slDistPct  // positive = above SL (long) / below SL (short)
            const consumed = Math.max(0, SL_BASE_PCT - cushion)
            const slPct = Math.min(100, (consumed / SL_BASE_PCT) * 100)
            const cushionLabel = cushion >= 0
              ? `${cushion.toFixed(2)}% cushion`
              : `+${Math.abs(cushion).toFixed(2)}% past SL`
            return (
              <div className="adm-asset-meter">
                <div className="adm-asset-meter-head">
                  <span
                    className="adm-asset-lab"
                    title="Bar fills as price moves toward the 4% stop loss. Empty = full cushion. Full = SL hit."
                  >
                    SL danger · fires at full
                  </span>
                  <span className={'num ' + (slPct >= 75 ? 'neg-text' : slPct >= 50 ? '' : 'pos-text')}>
                    {slPct.toFixed(0)}% used · {cushionLabel}
                  </span>
                </div>
                <div className="adm-meter-bar">
                  <div className="adm-meter-fill adm-meter-fill-red" style={{ width: slPct + '%' }} />
                  {/* 50% mark (halfway-to-stop warning line) */}
                  <div className="adm-meter-mark adm-meter-mark-red" style={{ left: '50%' }} />
                </div>
              </div>
            )
          })()}

          {pos.pyramidAdded && (
            <div className="adm-asset-pyramid">
              <span className="badge badge-long" style={{ background: 'rgba(212,160,23,0.15)', color: 'var(--gold)', borderColor: 'rgba(212,160,23,0.4)' }}>PYRAMIDED</span>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="adm-asset-grid3">
            <div>
              <div className="adm-asset-lab">HVN</div>
              <div className="adm-asset-val num">{fmtPx(a.hvn ?? null)}</div>
            </div>
            <div>
              <div className="adm-asset-lab">Long ≥</div>
              <div className="adm-asset-val num pos-text">{fmtPx(a.breakoutLong)}</div>
              {a.distToLongPct != null && <div className="adm-asset-sub">{a.distToLongPct >= 0 ? '+' : '−'}{Math.abs(a.distToLongPct).toFixed(2)}%</div>}
            </div>
            <div>
              <div className="adm-asset-lab">Short ≤</div>
              <div className="adm-asset-val num neg-text">{fmtPx(a.breakoutShort)}</div>
              {a.distToShortPct != null && <div className="adm-asset-sub">{a.distToShortPct >= 0 ? '+' : '−'}{Math.abs(a.distToShortPct).toFixed(2)}%</div>}
            </div>
          </div>
        </>
      )}

      {/* bbW gate footer */}
      <div className="adm-asset-meter">
        <div className="adm-asset-meter-head">
          <span className="adm-asset-lab">bbW gate</span>
          <span className={'num ' + (a.bbWPass ? 'pos-text' : '')}>
            {(a.bbW ?? 0).toFixed(1)}% / {(a.bbWThresh ?? 0)}% {a.bbWPass ? '✓' : ''}
          </span>
        </div>
        <div className="adm-meter-bar">
          <div
            className={'adm-meter-fill ' + (a.bbWPass ? 'adm-meter-fill-pos' : 'adm-meter-fill-muted')}
            style={{ width: bbPct + '%' }}
          />
          {a.bbWThresh != null && bbMax > 0 && (
            <div className="adm-meter-mark" style={{ left: ((a.bbWThresh / bbMax) * 100) + '%' }} />
          )}
        </div>
      </div>
    </div>
  )
}

function HealthChip({ name, h }: { name: string; h: any }) {
  const ok = !!h?.ok
  return (
    <div className={'adm-health-chip ' + (ok ? 'adm-health-ok' : 'adm-health-bad')}>
      <span className={ok ? 'dot-live' : 'dot-stale'} />
      <span className="adm-health-name">{name}</span>
      <span className="adm-health-state">{h?.label || '—'}</span>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Execution panel — per-signal parity check (live engine vs sim)
// ────────────────────────────────────────────────────────────────────────────

// Parity validator severity tiers (3-tier, 2026-05-09):
//   'critical' — true engine/sim disagreement (>1% drift, missing match,
//                direction mismatch). Loud alert.
//   'warning'  — 0.25–1% drift. Quiet alert, worth noting if it persists.
//   'ok'       — <0.25% drift. Suppressed (exchange noise).
// Legacy values kept for backwards compat with old results JSON entries:
//   'drift'      → render as warning
//   'fail'       → render as critical
//   'incomplete' → render as warning
type ParitySeverity = 'ok' | 'warning' | 'critical' | 'drift' | 'fail' | 'incomplete'

type ParityRecord = {
  id: string
  asset: string
  sym: string
  type: string         // ENTRY | EXIT | PYRAMID
  side: string         // long | short
  dir: 1 | -1 | 0
  liveTs: number
  livePx: number | null
  slPx: number | null
  reason: string | null
  retries: number
  severity: ParitySeverity
  match: {
    simTs: number | null
    simPx: number | null
    simReason: string | null
    simIdx: number | null
    offsetSec: number | null
    priceDiffPct: number | null
    status: string | null
  } | null
  notFoundReason: string | null
  dispatchedAt: number
}

type ParityResp = {
  ts: number
  counts: {
    total: number
    filtered: number
    last24h: number
    severity: Record<string, number>
    severity24h: Record<string, number>
  }
  recent: ParityRecord[]
  pendingChecks: Array<{ id: string; asset: string; type: string; side: string; ts: number; scheduledAt: number; retries: number }>
  simFreshness: Array<{ asset: string; sym: string; mtimeMs: number | null; ageMs: number | null; tradeCount: number; missing?: boolean }>
  logTail: string[]
}

function ExecutionPanel({ active }: { active: boolean }) {
  const [sevFilter, setSevFilter] = useState<'all' | ParitySeverity>('all')
  const [symFilter, setSymFilter] = useState<string>('all')
  const fetcher = useCallback(async () => {
    const q = new URLSearchParams({ limit: '100' })
    if (sevFilter !== 'all') q.set('severity', sevFilter)
    if (symFilter !== 'all') q.set('symbol', symFilter)
    return authedFetch<ParityResp>(`/api/admin/parity?${q}`)
  }, [sevFilter, symFilter])
  const px = usePanelData<ParityResp>(active, fetcher, 30_000, `${sevFilter}|${symFilter}`)
  const r = px.data

  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="ADMIN · EXECUTION · PARITY"
        lead="Live engine vs"
        accent="sim."
        blurb="Per-signal parity check — every live emission is matched against the backtest simulator's recorded trade and flagged when they drift. Same data as the Telegram report. Refreshes every 30s."
        refreshing={px.loading}
        onRefresh={px.refresh}
      />
      <ErrorBox msg={px.error} />

      {/* 24h header stats */}
      <div className="row row-stats">
        <StatCard label="Last 24h" value={r ? r.counts.last24h : '—'} sub="signals checked" />
        {/* 3-tier severity: OK (suppressed) / Warning (0.25-1%) / Critical (>1% or missing) */}
        <StatCard label="OK" value={r ? (r.counts.severity24h.ok || 0) : '—'} tone="pos" />
        <StatCard label="Warning" value={r ? ((r.counts.severity24h.warning || 0) + (r.counts.severity24h.drift || 0) + (r.counts.severity24h.incomplete || 0)) : '—'} tone={((r?.counts.severity24h.warning || 0) + (r?.counts.severity24h.drift || 0) + (r?.counts.severity24h.incomplete || 0)) > 0 ? 'gold' : 'muted'} />
        <StatCard label="Critical" value={r ? ((r.counts.severity24h.critical || 0) + (r.counts.severity24h.fail || 0)) : '—'} tone={((r?.counts.severity24h.critical || 0) + (r?.counts.severity24h.fail || 0)) > 0 ? 'neg' : 'muted'} />
      </div>

      {/* Sim file freshness — tells you why NOT_FOUND happens */}
      <SectionCard title="SIM FILE FRESHNESS">
        <div className="adm-feed-grid">
          {(r?.simFreshness || []).map(s => {
            const stale = s.missing || (s.ageMs != null && s.ageMs > 15 * 60 * 1000)
            const ageLabel = s.ageMs == null ? '—' : s.ageMs < 60_000 ? Math.round(s.ageMs / 1000) + 's' : Math.round(s.ageMs / 60_000) + 'm'
            return (
              <div key={s.asset} className={'adm-feed-cell' + (stale ? ' adm-feed-stale' : '')}>
                <div className="adm-feed-head">
                  <span className={stale ? 'dot-stale' : 'dot-live'} />
                  <span className="num" style={{ fontWeight: 600 }}>{s.sym}</span>
                </div>
                <div className="adm-feed-meta">{s.tradeCount} trades</div>
                <div className="adm-feed-meta sub">{s.missing ? 'sim file missing' : `last write ${ageLabel} ago`}</div>
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* Filters */}
      <div className="adm-filter-row">
        <SubPills
          value={sevFilter}
          onChange={setSevFilter}
          items={[
            { id: 'all', label: 'All', count: r?.counts.total ?? null },
            { id: 'ok', label: 'OK', count: r?.counts.severity.ok ?? null },
            // Combine new + legacy buckets so the count reflects all warnings/criticals
            { id: 'warning', label: 'Warning', count: r ? ((r.counts.severity.warning || 0) + (r.counts.severity.drift || 0) + (r.counts.severity.incomplete || 0)) : null },
            { id: 'critical', label: 'Critical', count: r ? ((r.counts.severity.critical || 0) + (r.counts.severity.fail || 0)) : null },
          ]}
        />
        <select
          value={symFilter}
          onChange={(e) => setSymFilter(e.target.value)}
          className="settings-input adm-select"
          style={{ marginLeft: 'auto' }}
        >
          <option value="all">All symbols</option>
          <option value="BTCUSDT">BTC</option>
          <option value="ETHUSDT">ETH</option>
          <option value="SOLUSDT">SOL</option>
          <option value="XRPUSDT">XRP</option>
          <option value="SUIUSDT">SUI</option>
        </select>
      </div>

      {/* Pending checks (if any) */}
      {r && r.pendingChecks.length > 0 && (
        <SectionCard title="PENDING CHECKS">
          <div className="adm-pending-grid">
            {r.pendingChecks.map(p => {
              const minsToCheck = Math.max(0, Math.round((p.scheduledAt - Date.now()) / 60000))
              return (
                <div key={p.id} className="adm-pending-cell">
                  <div className="adm-pending-head">
                    <span className={'badge ' + (p.side === 'long' ? 'badge-long' : 'badge-short')}>{p.side?.toUpperCase()}</span>
                    <span className="num" style={{ fontWeight: 600 }}>{p.asset.replace('USDT', '')}</span>
                    <span className="adm-stat-sub">{p.type}</span>
                  </div>
                  <div className="adm-stat-sub" style={{ marginTop: 4 }}>
                    Live emit {fmtAge(p.ts)} · check in {minsToCheck}m · retry {p.retries}
                  </div>
                </div>
              )
            })}
          </div>
        </SectionCard>
      )}

      {/* Recent parity records */}
      {!r || r.recent.length === 0 ? (
        <SectionCard title="PARITY HISTORY">
          <EmptyBox>{px.loading ? 'Loading…' : 'No parity checks in this filter yet.'}</EmptyBox>
        </SectionCard>
      ) : (
        <div className="adm-parity-list">
          {r.recent.map(rec => <ParityCard key={rec.id} r={rec} />)}
        </div>
      )}

      {/* Log tail (collapsed by default) */}
      {r && r.logTail.length > 0 && (
        <SectionCard title="VALIDATOR LOG · last 30 lines">
          <pre className="adm-log-tail">{r.logTail.join('\n')}</pre>
        </SectionCard>
      )}
    </div>
  )
}

function ParityCard({ r }: { r: ParityRecord }) {
  // 3-tier severity (2026-05-09). Legacy values rendered with a sane mapping.
  const sevConfig = {
    ok:         { cls: 'adm-parity-ok',         icon: '✓',  label: 'PARITY OK',                tone: 'pos'  as const },
    warning:    { cls: 'adm-parity-drift',      icon: '⚠️', label: 'PARITY DRIFT — Warning',  tone: 'gold' as const },
    critical:   { cls: 'adm-parity-fail',       icon: '🚨', label: 'PARITY DRIFT — Critical', tone: 'neg'  as const },
    // Legacy mappings — render but call out the source
    drift:      { cls: 'adm-parity-drift',      icon: '⚠️', label: 'PARITY DRIFT (legacy)',   tone: 'gold' as const },
    fail:       { cls: 'adm-parity-fail',       icon: '❌', label: 'PARITY FAILED (legacy)',  tone: 'neg'  as const },
    incomplete: { cls: 'adm-parity-incomplete', icon: '·',  label: 'INCOMPLETE',               tone: 'muted' as const },
  }[r.severity] || { cls: 'adm-parity-incomplete', icon: '·', label: 'INCOMPLETE', tone: 'muted' as const }
  const dispatchedIso = new Date(r.dispatchedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  const liveIso = new Date(r.liveTs).toISOString().slice(11, 16) + ' UTC'
  const sideBadge = r.side === 'long' ? 'badge-long' : 'badge-short'
  const sideEmoji = r.dir === 1 ? '🟢' : r.dir === -1 ? '🔴' : '⚪'

  return (
    <div className={'card card-pad adm-parity ' + sevConfig.cls}>
      <div className="adm-parity-head">
        <span className="adm-parity-icon">{sevConfig.icon}</span>
        <span className={'adm-parity-label ' + sevConfig.tone + '-text'}>{sevConfig.label}</span>
        <span className="adm-parity-time num adm-mono-sm">{dispatchedIso}</span>
      </div>

      <div className="adm-parity-body">
        <div className="adm-parity-asset">
          <span style={{ fontSize: 16 }}>{sideEmoji}</span>
          <strong className="num" style={{ fontSize: 15 }}>{r.sym}</strong>
          <span className="adm-stat-sub">{r.type}</span>
          <span className={'badge ' + sideBadge}>{(r.side || '').toUpperCase()}</span>
          {r.reason && <span className="adm-stat-sub" style={{ marginLeft: 8 }}>· {r.reason}</span>}
        </div>

        <div className="adm-parity-cmp">
          <div className="adm-parity-row">
            <span className="adm-parity-rowlab">Live</span>
            <span className="num">{r.livePx != null ? fmtPx(r.livePx) : '—'}</span>
            <span className="adm-stat-sub">@ {liveIso}</span>
          </div>
          {r.match ? (
            <>
              <div className="adm-parity-row">
                <span className="adm-parity-rowlab">Sim</span>
                <span className="num">{r.match.simPx != null ? fmtPx(r.match.simPx) : '—'}</span>
                {r.match.offsetSec != null && (
                  <span className="adm-stat-sub">offset {r.match.offsetSec >= 0 ? '+' : ''}{r.match.offsetSec}s</span>
                )}
                {r.match.simReason && <span className="adm-stat-sub">· sim reason: {r.match.simReason}</span>}
              </div>
              {r.match.priceDiffPct != null && (
                <div className="adm-parity-row">
                  <span className="adm-parity-rowlab">Diff</span>
                  <span className={'num ' + (r.severity === 'ok' ? 'pos-text' : 'neg-text')}>
                    {r.match.priceDiffPct.toFixed(3)}%
                  </span>
                  <span className="adm-stat-sub">
                    {r.severity === 'ok' ? 'within 0.1% tolerance ✓' : 'exceeds 0.1% tolerance ⚠'}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="adm-parity-row">
              <span className="adm-parity-rowlab neg-text">Sim</span>
              <span className="neg-text">no match</span>
              {r.notFoundReason && <span className="adm-stat-sub">· {r.notFoundReason}</span>}
              <span className="adm-stat-sub">retries: {r.retries}</span>
            </div>
          )}
        </div>
      </div>

      <div className="adm-parity-footer">
        <span className="adm-mono-sm">{r.id}</span>
        {r.slPx != null && <span className="adm-stat-sub">SL {fmtPx(r.slPx)}</span>}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Alerts panel
// ────────────────────────────────────────────────────────────────────────────

type AlertItem = {
  id: string
  alert_type: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  description: string | null
  signal_id: string | null
  trade_id: string | null
  resolved_at: string | null
  created_at: string
  _source?: 'file' | 'recon' | 'db'
  profiles?: { email?: string; full_name?: string } | null
}

type AlertsResponse = { alerts: AlertItem[]; dbCount?: number; fileCount?: number; total?: number }

function AlertsPanel({ active }: { active: boolean }) {
  const [severity, setSeverity] = useState<string>('')
  const [resolved, setResolved] = useState<'false' | 'true' | ''>('false')
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

  const fetcher = useCallback(async () => {
    const q = new URLSearchParams()
    if (severity) q.set('severity', severity)
    if (resolved) q.set('resolved', resolved)
    q.set('limit', '200')
    return authedFetch<AlertsResponse>(`/api/admin/alerts?${q}`)
  }, [severity, resolved])

  // revalidateKey ties the cache to the filter state — change it, refetch.
  const al = usePanelData<AlertsResponse>(active, fetcher, 30_000, `${severity}|${resolved}`)

  async function resolveOne(id: string) {
    if (id.startsWith('file:') || id.startsWith('recon:')) return
    setBusyIds(s => new Set(s).add(id))
    try {
      await authedFetch('/api/admin/alerts', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'resolve_bulk', alert_ids: [id] }),
      })
      al.refresh()
    } finally {
      setBusyIds(s => { const n = new Set(s); n.delete(id); return n })
    }
  }

  const list = al.data?.alerts || []

  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="ADMIN · ALERTS"
        lead="Reconciliation and"
        accent="warnings."
        blurb="Aggregated from DB alerts + live file-based alerts (guardian, executor, recon-cron). Auto-refreshes every 30s."
        refreshing={al.loading}
        onRefresh={al.refresh}
      />
      <ErrorBox msg={al.error} />

      {/* Filters */}
      <div className="adm-filter-row">
        <label className="adm-filter">
          <span>Severity</span>
          <select value={severity} onChange={e => setSeverity(e.target.value)} className="settings-input adm-select">
            <option value="">All</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
        </label>
        <label className="adm-filter">
          <span>Status</span>
          <select value={resolved} onChange={e => setResolved(e.target.value as any)} className="settings-input adm-select">
            <option value="false">Unresolved</option>
            <option value="true">Resolved</option>
            <option value="">All</option>
          </select>
        </label>
        <span className="adm-filter-summary">
          {al.data?.total ?? 0} total · DB {al.data?.dbCount ?? 0} · file {al.data?.fileCount ?? 0}
        </span>
      </div>

      {list.length === 0 ? (
        <SectionCard title="ALERTS">
          <EmptyBox>No alerts matching filters.</EmptyBox>
        </SectionCard>
      ) : (
        <div className="adm-alerts-list">
          {list.map(a => (
            <div key={a.id} className={'card card-pad adm-alert-card adm-alert-' + a.severity + (a.resolved_at ? ' adm-alert-resolved' : '')}>
              <div className="adm-alert-head">
                <span className={'badge adm-sev-' + a.severity}>{a.severity.toUpperCase()}</span>
                <span className="adm-alert-type">{a.alert_type}</span>
                {a._source && <span className="adm-alert-source">{a._source}</span>}
                <span className="adm-alert-age">{fmtAge(a.created_at)}</span>
              </div>
              <div className="adm-alert-title">{a.title}</div>
              {a.description && <div className="adm-alert-desc">{a.description}</div>}
              <div className="adm-alert-meta">
                {a.profiles?.email && <span>user: {a.profiles.email}</span>}
                {a.signal_id && <span>signal: {a.signal_id}</span>}
                {a.trade_id && <span>trade: {a.trade_id}</span>}
              </div>
              {!a._source && !a.resolved_at && (
                <button
                  type="button"
                  className="adm-resolve-btn"
                  onClick={() => resolveOne(a.id)}
                  disabled={busyIds.has(a.id)}
                >{busyIds.has(a.id) ? '…' : 'Resolve'}</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Risk panel
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// (Risk panel removed 2026-05-08 — Chris's call. Per-bot risk validation
// is no longer surfaced in the admin shell. /api/admin/risk-guardian still
// exists for any external consumer; remove if nothing else calls it.)
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// 6. Users panel — sub-tabs for users / waitlist / brokers
// ────────────────────────────────────────────────────────────────────────────

type UserSub = 'users' | 'waitlist' | 'brokers'

function UsersPanel({ active }: { active: boolean }) {
  const [sub, setSub] = useState<UserSub>('users')
  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="ADMIN · COMMUNITY"
        lead="Users, waitlist,"
        accent="brokers."
        blurb="Roster of paying users, waitlist queue, and broker-program partners. Search, paginate, drill down."
      />
      <SubPills
        value={sub}
        onChange={setSub}
        items={[
          { id: 'users', label: 'Users' },
          { id: 'waitlist', label: 'Waitlist' },
          { id: 'brokers', label: 'Brokers' },
        ]}
      />
      <div style={{ display: sub === 'users' ? 'block' : 'none' }}><UsersList active={active && sub === 'users'} /></div>
      <div style={{ display: sub === 'waitlist' ? 'block' : 'none' }}><WaitlistList active={active && sub === 'waitlist'} /></div>
      <div style={{ display: sub === 'brokers' ? 'block' : 'none' }}><BrokersList active={active && sub === 'brokers'} /></div>
    </div>
  )
}

type UserRow = {
  id: string
  email: string
  full_name?: string | null
  display_name?: string | null
  role: string
  status: string
  created_at: string
  bot_activated?: boolean
  preset?: string | null
  total_trades?: number
  total_pnl_usd?: number | null
  last_trade_at?: string | null
}
type UsersResponse = { users: UserRow[]; total: number }

function UsersList({ active }: { active: boolean }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const limit = 50

  const fetcher = useCallback(async () => {
    const q = new URLSearchParams({ page: String(page), limit: String(limit), sort: 'user_created_at', dir: 'desc' })
    if (search.trim()) q.set('search', search.trim())
    return authedFetch<UsersResponse>(`/api/admin/users?${q}`)
  }, [search, page])
  const u = usePanelData<UsersResponse>(active, fetcher, 60_000, `${search.trim()}|${page}`)
  const pages = Math.max(1, Math.ceil((u.data?.total || 0) / limit))

  return (
    <>
      <div className="adm-search-row">
        <div className="adm-search">
          <Search size={14} />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search email or name"
            className="settings-input adm-search-input"
          />
        </div>
        <span className="adm-filter-summary">{u.data?.total ?? 0} total</span>
      </div>
      <ErrorBox msg={u.error} />

      <SectionCard title="USERS">
        {(u.data?.users || []).length === 0 ? (
          <EmptyBox>No users in this filter.</EmptyBox>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Bot</th><th>Preset</th>
                  <th style={{ textAlign: 'right' }}>Trades</th><th style={{ textAlign: 'right' }}>PnL</th>
                  <th>Last trade</th><th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {u.data!.users.map(row => (
                  <tr key={row.id}>
                    <td className="adm-truncate" style={{ maxWidth: 240 }}>{row.email}</td>
                    <td style={{ color: 'var(--muted)' }}>{row.full_name || row.display_name || '—'}</td>
                    <td style={{ color: 'var(--muted)' }}>{row.role}</td>
                    <td><span className={'badge ' + (row.status === 'active' ? 'badge-long' : 'adm-badge-flat')}>{row.status}</span></td>
                    <td>{row.bot_activated ? <span className="pos-text">✓</span> : <span style={{ color: 'var(--muted-2)' }}>—</span>}</td>
                    <td style={{ color: 'var(--muted)' }}>{row.preset || '—'}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{row.total_trades ?? 0}</td>
                    <td className="num" style={{ textAlign: 'right' }}>
                      <span className={(row.total_pnl_usd ?? 0) > 0 ? 'pos-text' : (row.total_pnl_usd ?? 0) < 0 ? 'neg-text' : ''}>{fmtUsd(row.total_pnl_usd, true)}</span>
                    </td>
                    <td style={{ color: 'var(--muted)' }}>{row.last_trade_at ? new Date(row.last_trade_at).toISOString().slice(0, 10) : '—'}</td>
                    <td style={{ color: 'var(--muted)' }}>{row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="adm-pagination">
            <button type="button" className="settings-btn-secondary" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</button>
            <span className="adm-page-num">Page {page} / {pages}</span>
            <button type="button" className="settings-btn-secondary" disabled={page === pages} onClick={() => setPage(p => Math.min(pages, p + 1))}>Next</button>
          </div>
        )}
      </SectionCard>
    </>
  )
}

type WaitlistResp = {
  entries: Array<{ email: string; full_name?: string; queue_position?: number; referral_code?: string; notified_at?: string; created_at: string }>
  total?: number
  notified?: number
  pending?: number
}

function WaitlistList({ active }: { active: boolean }) {
  const w = usePanelData<WaitlistResp>(active, () => authedFetch('/api/admin/waitlist?limit=200'), 60_000)
  return (
    <>
      <ErrorBox msg={w.error} />
      <div className="row row-stats">
        <StatCard label="Total" value={w.data?.total ?? '—'} />
        <StatCard label="Notified" value={w.data?.notified ?? '—'} tone="pos" />
        <StatCard label="Pending" value={w.data?.pending ?? '—'} tone="gold" />
      </div>
      <SectionCard title="WAITLIST">
        {(w.data?.entries || []).length === 0 ? <EmptyBox>No waitlist entries.</EmptyBox> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="adm-table">
              <thead><tr><th>Email</th><th>Name</th><th style={{ textAlign: 'right' }}>Position</th><th>Ref</th><th>Notified</th><th>Joined</th></tr></thead>
              <tbody>
                {w.data!.entries.map((e, i) => (
                  <tr key={i}>
                    <td className="adm-truncate" style={{ maxWidth: 240 }}>{e.email}</td>
                    <td style={{ color: 'var(--muted)' }}>{e.full_name || '—'}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{e.queue_position ?? '—'}</td>
                    <td className="num" style={{ color: 'var(--muted)' }}>{e.referral_code || '—'}</td>
                    <td style={{ color: 'var(--muted)' }}>{e.notified_at ? new Date(e.notified_at).toISOString().slice(0, 10) : '—'}</td>
                    <td style={{ color: 'var(--muted)' }}>{new Date(e.created_at).toISOString().slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  )
}

type BrokersResp = {
  applications: Array<{ broker_email?: string; referral_code?: string; split_pct?: number; referred_count?: number; total_earned_usd?: number; approved_at?: string }>
  total?: number; active?: number; referred_users?: number; total_earnings?: number
}

function BrokersList({ active }: { active: boolean }) {
  const b = usePanelData<BrokersResp>(active, () => authedFetch('/api/admin/broker/applications?limit=200'), 60_000)
  return (
    <>
      <ErrorBox msg={b.error} />
      <div className="row row-stats">
        <StatCard label="Total brokers" value={b.data?.total ?? '—'} />
        <StatCard label="Active" value={b.data?.active ?? '—'} tone="pos" />
        <StatCard label="Referred users" value={b.data?.referred_users ?? '—'} />
        <StatCard label="Earnings" value={fmtUsd(b.data?.total_earnings ?? null)} tone="gold" />
      </div>
      <SectionCard title="BROKER APPLICATIONS">
        {(b.data?.applications || []).length === 0 ? <EmptyBox>No brokers.</EmptyBox> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="adm-table">
              <thead><tr><th>Broker</th><th>Code</th><th style={{ textAlign: 'right' }}>Split</th><th style={{ textAlign: 'right' }}>Referred</th><th style={{ textAlign: 'right' }}>Earned</th><th>Approved</th></tr></thead>
              <tbody>
                {b.data!.applications.map((row, i) => (
                  <tr key={i}>
                    <td className="adm-truncate" style={{ maxWidth: 240 }}>{row.broker_email || '—'}</td>
                    <td className="num" style={{ color: 'var(--muted)' }}>{row.referral_code || '—'}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{(row.split_pct ?? 25) + '%'}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{row.referred_count ?? 0}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{fmtUsd(row.total_earned_usd, false, 2)}</td>
                    <td style={{ color: 'var(--muted)' }}>{row.approved_at ? new Date(row.approved_at).toISOString().slice(0, 10) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 7. Revenue panel — sub-tabs for revenue / invoices / payouts
// ────────────────────────────────────────────────────────────────────────────

type RevSub = 'revenue' | 'invoices' | 'payouts'

function RevenuePanel({ active }: { active: boolean }) {
  const [sub, setSub] = useState<RevSub>('revenue')
  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="ADMIN · REVENUE"
        lead="MRR, invoices, and"
        accent="payouts."
        blurb="Subscription revenue, performance fees, broker payouts. 30-day rolling unless noted."
      />
      <SubPills
        value={sub}
        onChange={setSub}
        items={[
          { id: 'revenue', label: 'Revenue' },
          { id: 'invoices', label: 'Invoices' },
          { id: 'payouts', label: 'Payouts' },
        ]}
      />
      <div style={{ display: sub === 'revenue' ? 'block' : 'none' }}><RevenueList active={active && sub === 'revenue'} /></div>
      <div style={{ display: sub === 'invoices' ? 'block' : 'none' }}><InvoicesList active={active && sub === 'invoices'} /></div>
      <div style={{ display: sub === 'payouts' ? 'block' : 'none' }}><PayoutsList active={active && sub === 'payouts'} /></div>
    </div>
  )
}

type RevResp = {
  rows: Array<{ date?: string; source?: string; description?: string; amount_usd: number }>
  mrr?: number; active_subs?: number; perf_fees_30d?: number; total_30d?: number
}

function RevenueList({ active }: { active: boolean }) {
  const r = usePanelData<RevResp>(active, () => authedFetch('/api/admin/revenue'), 60_000)
  return (
    <>
      <ErrorBox msg={r.error} />
      <div className="row row-stats">
        <StatCard label="MRR" value={fmtUsd(r.data?.mrr ?? null)} tone="gold" />
        <StatCard label="Active subs" value={r.data?.active_subs ?? '—'} tone="pos" />
        <StatCard label="Perf fees (30d)" value={fmtUsd(r.data?.perf_fees_30d ?? null)} />
        <StatCard label="Total (30d)" value={fmtUsd(r.data?.total_30d ?? null)} tone="pos" />
      </div>
      <SectionCard title="REVENUE LEDGER">
        {(r.data?.rows || []).length === 0 ? <EmptyBox>No revenue rows.</EmptyBox> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="adm-table">
              <thead><tr><th>Date</th><th>Source</th><th>Description</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
              <tbody>
                {r.data!.rows.map((row, i) => (
                  <tr key={i}>
                    <td className="num">{row.date ? row.date.slice(0, 10) : '—'}</td>
                    <td>{row.source || '—'}</td>
                    <td style={{ color: 'var(--muted)' }}>{row.description || '—'}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{fmtUsd(row.amount_usd, false, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  )
}

type InvResp = { invoices: Array<{ number?: string; user_email?: string; status?: string; amount_usd: number; issued_at?: string; paid_at?: string }> }
function InvoicesList({ active }: { active: boolean }) {
  const inv = usePanelData<InvResp>(active, () => authedFetch('/api/admin/invoices?limit=200'), 60_000)
  return (
    <>
      <ErrorBox msg={inv.error} />
      <SectionCard title="INVOICES">
        {(inv.data?.invoices || []).length === 0 ? <EmptyBox>No invoices.</EmptyBox> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="adm-table">
              <thead><tr><th>Invoice #</th><th>User</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th><th>Issued</th><th>Paid</th></tr></thead>
              <tbody>
                {inv.data!.invoices.map((row, i) => (
                  <tr key={i}>
                    <td className="num">{row.number || '—'}</td>
                    <td className="adm-truncate" style={{ maxWidth: 240 }}>{row.user_email || '—'}</td>
                    <td>{row.status || '—'}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{fmtUsd(row.amount_usd, false, 2)}</td>
                    <td style={{ color: 'var(--muted)' }}>{row.issued_at ? new Date(row.issued_at).toISOString().slice(0, 10) : '—'}</td>
                    <td style={{ color: 'var(--muted)' }}>{row.paid_at ? new Date(row.paid_at).toISOString().slice(0, 10) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  )
}

type PayResp = { payouts: Array<{ broker_email?: string; referral_code?: string; period?: string; status?: string; amount_usd: number; created_at?: string }>; pending_count?: number; paid_total?: number }
function PayoutsList({ active }: { active: boolean }) {
  const p = usePanelData<PayResp>(active, () => authedFetch('/api/admin/payouts?limit=200'), 60_000)
  return (
    <>
      <ErrorBox msg={p.error} />
      <div className="row row-stats">
        <StatCard label="Pending" value={p.data?.pending_count ?? '—'} tone="gold" />
        <StatCard label="Paid total" value={fmtUsd(p.data?.paid_total ?? null)} tone="pos" />
      </div>
      <SectionCard title="BROKER PAYOUTS">
        {(p.data?.payouts || []).length === 0 ? <EmptyBox>No payouts.</EmptyBox> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="adm-table">
              <thead><tr><th>Broker</th><th>Code</th><th>Period</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th><th>Created</th></tr></thead>
              <tbody>
                {p.data!.payouts.map((row, i) => (
                  <tr key={i}>
                    <td className="adm-truncate" style={{ maxWidth: 240 }}>{row.broker_email || '—'}</td>
                    <td className="num" style={{ color: 'var(--muted)' }}>{row.referral_code || '—'}</td>
                    <td>{row.period || '—'}</td>
                    <td>{row.status || '—'}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{fmtUsd(row.amount_usd, false, 2)}</td>
                    <td style={{ color: 'var(--muted)' }}>{row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 8. Wallets panel
// ────────────────────────────────────────────────────────────────────────────

type WalletsResp = { wallets: Array<{ label?: string; network?: string; coin?: string; wallet_address?: string; is_active?: boolean; created_at?: string }> }

function WalletsPanel({ active }: { active: boolean }) {
  const w = usePanelData<WalletsResp>(active, () => authedFetch('/api/admin/wallets?limit=200'), 60_000)
  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="ADMIN · WALLETS"
        lead="Company crypto"
        accent="wallets."
        blurb="Payout addresses for invoices and broker settlement. Per-network."
        refreshing={w.loading}
        onRefresh={w.refresh}
      />
      <ErrorBox msg={w.error} />
      <SectionCard title="COMPANY WALLETS">
        {(w.data?.wallets || []).length === 0 ? <EmptyBox>No wallets configured.</EmptyBox> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="adm-table">
              <thead><tr><th>Label</th><th>Network</th><th>Coin</th><th>Address</th><th>Active</th><th>Added</th></tr></thead>
              <tbody>
                {w.data!.wallets.map((row, i) => {
                  const a = String(row.wallet_address || '')
                  const short = a.length > 24 ? `${a.slice(0, 18)}…${a.slice(-6)}` : a
                  return (
                    <tr key={i}>
                      <td>{row.label || '—'}</td>
                      <td>{row.network || '—'}</td>
                      <td>{row.coin || '—'}</td>
                      <td className="num adm-mono-sm">{short || '—'}</td>
                      <td>{row.is_active ? <span className="pos-text">✓</span> : <span className="neg-text">off</span>}</td>
                      <td style={{ color: 'var(--muted)' }}>{row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 9. Strategy panel — sub-tabs for Research / Spec / Comparison / Architecture
// ────────────────────────────────────────────────────────────────────────────

type StratSub = 'research' | 'spec' | 'comparison' | 'architecture'

function StrategyPanel({ active }: { active: boolean }) {
  const [sub, setSub] = useState<StratSub>('research')
  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="ADMIN · STRATEGY"
        lead="Research, specs, and"
        accent="comparisons."
        blurb="HoneyBadger phase research, Satoshi Stacker live spec, 3-way signal comparison, and the execution-pipeline diagram. All native to v2 — single source of truth for backtest archives and pipeline docs."
      />
      <SubPills
        value={sub}
        onChange={setSub}
        items={[
          { id: 'research', label: 'Research' },
          { id: 'spec', label: 'Spec' },
          { id: 'comparison', label: 'Comparison' },
          { id: 'architecture', label: 'Architecture' },
        ]}
      />
      <div style={{ display: sub === 'research' ? 'block' : 'none' }}>
        <StrategyResearchPanel active={active && sub === 'research'} />
      </div>
      <div style={{ display: sub === 'spec' ? 'block' : 'none' }}>
        <SatoshiStackerSpecPanel active={active && sub === 'spec'} />
      </div>
      <div style={{ display: sub === 'comparison' ? 'block' : 'none' }}>
        <SignalComparisonPanel active={active && sub === 'comparison'} />
      </div>
      <div style={{ display: sub === 'architecture' ? 'block' : 'none' }}>
        <ExecutionArchitecturePanel active={active && sub === 'architecture'} />
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 10. Social panel — sub-tabs for Dispatch / Gallery
// ────────────────────────────────────────────────────────────────────────────

type SocSub = 'dispatch' | 'gallery'

function SocialPanel({ active }: { active: boolean }) {
  const [sub, setSub] = useState<SocSub>('dispatch')
  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="ADMIN · SOCIAL"
        lead="Queue review and"
        accent="dispatch."
        blurb="AI-generated post queue (review before going live to IG / X / Telegram), plus the trade-card gallery for raw and rendered cards."
      />
      <SubPills
        value={sub}
        onChange={setSub}
        items={[
          { id: 'dispatch', label: 'Dispatch queue' },
          { id: 'gallery', label: 'Card gallery' },
        ]}
      />
      <div style={{ display: sub === 'dispatch' ? 'block' : 'none' }}>
        <SocialDispatchPanel active={active && sub === 'dispatch'} />
      </div>
      <div style={{ display: sub === 'gallery' ? 'block' : 'none' }}>
        <SocialGalleryPanel active={active && sub === 'gallery'} />
      </div>
    </div>
  )
}
