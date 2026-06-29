'use client'

/**
 * Admin cockpit — v2 design. Settings-style left sub-nav (220px) plus
 * right-side panels:
 *
 *   Operations  →  Overview · Execution · Alerts · Users  (Radar removed 2026-05-25 — V1-locked)
 *   Broker      →  Brokers · Invoices · Payouts · Wallets
 *   Business    →  Revenue
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
import { PHASE_H_SYMBOLS } from '@/lib/phase-h-basket'
import {
  StrategyResearchPanel,
  BestStaxsPanel,
  // SatoshiStackerSpecPanel / StrategyOptimizationsPanel / ExecutionArchitecturePanel
  // are still exported but no longer wired into the StrategyPanel tabs. Dead-end
  // strategies removed 2026-05-17; only SwingMate remains.
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
  | 'overview' | 'execution' | 'health' | 'alerts' | 'users'
  | 'brokers' | 'broker-invoices' | 'broker-payouts' | 'wallets'
  | 'revenue' | 'strategy' | 'social'

type TabDef = { id: TabId; label: string; group: string; icon: React.ComponentType<IconProps> }

const TABS: TabDef[] = [
  { id: 'overview',         label: 'Overview',   group: 'Operations', icon: Icons.Grid },
  // Radar removed 2026-05-25: V1-locked, hardcoded 7-asset basket, V1 state
  // files no longer updating. Phase H equivalent lives in Live Trading +
  // Backtest pages. See SYSTEM_HANDOVER.md §5 Rule 26.
  { id: 'execution',        label: 'Execution',  group: 'Operations', icon: Icons.Signal },
  { id: 'health',           label: 'Health',     group: 'Operations', icon: Heart },
  { id: 'alerts',           label: 'Alerts',     group: 'Operations', icon: Icons.Bell },
  { id: 'users',            label: 'Users',      group: 'Operations', icon: People },
  { id: 'brokers',          label: 'Brokers',    group: 'Broker',     icon: People },
  { id: 'broker-invoices',  label: 'Invoices',   group: 'Broker',     icon: Receipt },
  { id: 'broker-payouts',   label: 'Payouts',    group: 'Broker',     icon: Dollar },
  { id: 'wallets',          label: 'Wallets',    group: 'Broker',     icon: Wallet },
  { id: 'revenue',          label: 'Revenue',    group: 'Business',   icon: Dollar },
  { id: 'strategy',         label: 'Strategy',   group: 'Research',   icon: Icons.Bars },
  { id: 'social',           label: 'Social',     group: 'Research',   icon: Megaphone },
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
      window.location.href = '/'
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
          <div style={{ display: tab === 'execution' ? 'block' : 'none' }}>
            <ExecutionPanel active={tab === 'execution'} />
          </div>
          <div style={{ display: tab === 'health' ? 'block' : 'none' }}>
            <SystemHealthPanel active={tab === 'health'} />
          </div>
          <div style={{ display: tab === 'alerts' ? 'block' : 'none' }}>
            <AlertsPanel active={tab === 'alerts'} />
          </div>
          <div style={{ display: tab === 'users' ? 'block' : 'none' }}>
            <UsersPanel active={tab === 'users'} />
          </div>
          <div style={{ display: tab === 'brokers' ? 'block' : 'none' }}>
            <BrokersPanel active={tab === 'brokers'} />
          </div>
          <div style={{ display: tab === 'broker-invoices' ? 'block' : 'none' }}>
            <BrokerInvoicesPanel active={tab === 'broker-invoices'} />
          </div>
          <div style={{ display: tab === 'broker-payouts' ? 'block' : 'none' }}>
            <BrokerPayoutsPanel active={tab === 'broker-payouts'} />
          </div>
          <div style={{ display: tab === 'wallets' ? 'block' : 'none' }}>
            <WalletsPanel active={tab === 'wallets'} />
          </div>
          <div style={{ display: tab === 'revenue' ? 'block' : 'none' }}>
            <RevenuePanel active={tab === 'revenue'} />
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
  recent_alerts: Array<{ id: string; alert_type: string; severity: string; title: string; description: string | null; created_at: string }>
  recent_signups: Array<{ email: string; full_name: string | null; created_at: string }>
  fetched_at: string
}

function OverviewPanel({ active }: { active: boolean }) {
  const ov = usePanelData<OverviewData>(active, () => authedFetch('/api/admin/overview'), 30_000)
  const o = ov.data?.overview
  const recentAlerts = ov.data?.recent_alerts || []
  const recentSignups = ov.data?.recent_signups || []

  // 2026-05-25 (Session 3) — overview is business-only. Engine state
  // belongs on the Health tab; live position state on Live Trading;
  // strategy backtest on Backtest. This tab points at those instead
  // of duplicating them.
  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="ADMIN · OVERVIEW"
        lead="Business"
        accent="snapshot."
        blurb="Pipeline counts + signups. Engine/cache/publisher state lives on Health. Position state on Live Trading. Strategy backtest on Backtest. Refreshes 30s."
        refreshing={ov.loading}
        onRefresh={ov.refresh}
      />
      <ErrorBox msg={ov.error} />

      {/* Business tiles only */}
      <div className="row row-stats">
        <StatCard label="Total users" value={(o?.total_leads ?? '—').toString()} />
        <StatCard label="Active subs" value={(o?.total_subscribed ?? '—').toString()} sub={`Trial ${o?.total_trial ?? '—'}`} />
        <StatCard label="API connected" value={(o?.total_connected ?? '—').toString()} />
        <StatCard
          label="Net profit"
          value={fmtUsd(o?.total_net_profit ?? null, true)}
          tone={(o?.total_net_profit ?? 0) >= 0 ? 'pos' : 'neg'}
        />
      </div>

      {/* Drill-down chips → other admin tabs / customer pages */}
      <SectionCard title="DRILL-DOWN">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/v2/admin?tab=health" className="badge" style={{ textDecoration: 'none' }}>System Health →</a>
          <a href="/v2/admin?tab=execution" className="badge" style={{ textDecoration: 'none' }}>Engine Parity →</a>
          <a href="/v2/admin?tab=alerts" className="badge" style={{ textDecoration: 'none' }}>Alerts →</a>
          <a href="/v2/admin?tab=users" className="badge" style={{ textDecoration: 'none' }}>Users →</a>
          <a href="/v2/live-trading" className="badge" style={{ textDecoration: 'none' }}>Live Trading →</a>
          <a href="/v2/backtesting" className="badge" style={{ textDecoration: 'none' }}>Backtest →</a>
        </div>
      </SectionCard>

      <div className="bt-twin-row">
        <SectionCard title={`RECENT ALERTS · ${recentAlerts.length}`}>
          {recentAlerts.length === 0 ? (
            <EmptyBox>No open alerts.</EmptyBox>
          ) : (
            <div className="adm-alert-list">
              {recentAlerts.slice(0, 5).map((a) => (
                <div key={a.id} className={'adm-alert ' + (a.severity === 'critical' ? 'adm-alert-crit' : 'adm-alert-warn')}>
                  <span className="adm-alert-sev">{a.severity.toUpperCase()}</span>
                  <span>
                    <strong>{a.title}</strong>
                    {a.description && <span style={{ color: 'var(--muted)', marginLeft: 8 }}>{a.description}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title={`RECENT SIGNUPS · ${recentSignups.length}`}>
          {recentSignups.length === 0 ? (
            <EmptyBox>No recent signups.</EmptyBox>
          ) : (
            <div className="adm-kvlist">
              {recentSignups.slice(0, 5).map((u, i) => (
                <div key={i} className="adm-kv">
                  <span style={{ fontWeight: 600 }}>{u.full_name || u.email}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 11 }}>{fmtAge(u.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="adm-footer-meta">
        <span style={{ color: 'var(--muted)', fontSize: 11 }}>
          Total volume: <span className="num">{fmtUsd(o?.total_volume ?? null)}</span>
        </span>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────────────
// 2. Execution panel — Live vs Shadow trade-level reconciliation
//    (Radar removed 2026-05-25: V1-locked, replaced by this panel)
// ────────────────────────────────────────────────────────────────────────────
//
// Architecture: Live engine = Bitget reality; Shadow = clean simulation.
// This panel shows both engines' trade ledgers side-by-side, paired by
// cfg_sid + entry bar timestamp. Divergence (price diff, PnL diff, timing)
// is the "execution friction" — the product's measurable value.
//
// Data: /api/admin/execution-comparison (new 2026-05-25).
// Refresh: 60s.

type TradeSide = {
  entry_ts_ms: number
  exit_ts_ms: number | null
  entry_bar_ts: number
  entry_price: number
  exit_price: number | null
  pnl_usd: number | null
  exit_reason: string | null
  open: boolean
  qty: number
  notional: number
  direction: 1 | -1
  tf: string
  // 2026-05-27: canonical current SL price. For OPEN positions overlaid
  // from each engine's state.json (engine sets SL post-entry, trades.jsonl
  // LIVE_ENTRY was written before that). For CLOSED trades, null unless
  // the exit was an SL fire (router stamps it on LIVE_EXIT).
  sl_price?: number | null
}

type CompSeverity = 'none' | 'minor' | 'severe'
type CompRow = {
  key: string
  cfg_sid: string
  shadow_cfg_sid?: string | null
  asset: string
  symbol: string
  tf: string
  entry_bar_ts: number
  // 2026-06-23 (audit #61): three NEW classes — off_script_exit / off_script_entry are
  // ALARMING breaches the tab was previously blind to (the WINDOW_EDGE/ETH +
  // GRAM-freelance classes); off_book is the SANCTIONED off-reference real set
  // (GRAM/TRX), surfaced but NEUTRAL.
  status: 'matched' | 'discrepancy' | 'live_only' | 'shadow_only' | 'pending'
    | 'off_script_exit' | 'off_script_entry' | 'off_book'
  severity: CompSeverity
  live: TradeSide | null
  shadow: TradeSide | null
  // 2026-06-15 triangulation: `shadow_daemon` = the paper-execution twin (live-vs-
  // shadow = EXECUTION drift); `shadow` is kept as the LIVEREF/published-canonical
  // reference (live-vs-liveref = convention/fidelity drift). `verdict` names the
  // outlier. `divergence_ls` is the live-vs-shadow_daemon delta (same shape as `divergence`).
  shadow_daemon: TradeSide | null
  divergence: {
    entry_price_diff: number | null
    entry_price_diff_pct: number | null
    exit_price_diff: number | null
    exit_price_diff_pct: number | null
    pnl_diff: number | null
    return_drift_pct: number | null
    timing_diff_ms: number | null
    eviction_mismatch: string | null
    time_breach: boolean
    price_breach: boolean
    cfg_mismatch: boolean
    severity: CompSeverity
    verdict: 'clean' | 'minor' | 'significant' | 'no_pair'
  } | null
  divergence_ls?: {
    entry_price_diff: number | null
    entry_price_diff_pct: number | null
    exit_price_diff: number | null
    exit_price_diff_pct: number | null
    pnl_diff: number | null
    return_drift_pct: number | null
    timing_diff_ms: number | null
    eviction_mismatch: string | null
    time_breach: boolean
    price_breach: boolean
    cfg_mismatch: boolean
    severity: CompSeverity
    verdict: 'clean' | 'minor' | 'significant' | 'no_pair'
  } | null
  verdict?: 'aligned' | 'liveref_outlier' | 'exec_drift' | 'one_sided' | 'pending' | 'live_missing'
    | 'off_script_exit' | 'off_script_entry' | 'off_book'
}

type CompResp = {
  trades: CompRow[]
  summary: {
    total: number
    matched: number
    discrepancy: number
    discrepancy_severe: number
    live_only: number
    shadow_only: number
    pending?: number
    // 2026-06-23 (audit #61): off-script / off-book class counts.
    off_script_exit?: number
    off_script_entry?: number
    off_book?: number
    mean_entry_price_divergence_pct: number
    // 2026-06-15 triangulation verdict counts (3-way live | shadow | liveref)
    aligned?: number
    liveref_outlier?: number
    exec_drift?: number
    tolerances?: { time_ms: number; price_pct: number; severe_time_ms: number; severe_price_pct: number }
  }
  as_of_ms: number
}

function ExecutionPanel({ active }: { active: boolean }) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'matched' | 'discrepancy' | 'live_only' | 'shadow_only' | 'pending' | 'off_script_exit' | 'off_script_entry' | 'off_book'>('all')
  const [assetFilter, setAssetFilter] = useState<string>('all')

  const fetcher = useCallback(async () => {
    const q = new URLSearchParams({ limit: '200' })
    if (statusFilter !== 'all') q.set('status', statusFilter)
    if (assetFilter !== 'all') q.set('asset', assetFilter)
    return authedFetch<CompResp>(`/api/admin/execution-comparison?${q}`)
  }, [statusFilter, assetFilter])
  const px = usePanelData<CompResp>(active, fetcher, 60_000, `${statusFilter}|${assetFilter}`)
  const r = px.data

  // (2026-06-08) PnL is now the price-move return % computed per-side from
  // entry/exit prices — no account-balance lookup needed.

  // Filter dropdown = the ONE canonical basket symbols (lib/phase-h-basket).
  // TON→GRAM rebrand + NEAR/OP propagate automatically.
  const PHASE_H_SYMS = PHASE_H_SYMBOLS

  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="ADMIN · ENGINE TRIANGULATION"
        lead="Live ·"
        accent="liveref."
        blurb={
          'Two-way trade reconciliation. LIVE = Bitget real fills (your account). LIVEREF = the published-canonical strategy book the Backtesting page serves. ' +
          'Paired by cfg_sid + entry bar; the Δ live·liveref delta surfaces any convention drift between your real fills and the canonical book. ' +
          'Refreshes every 60s.'
        }
        refreshing={px.loading}
        onRefresh={px.refresh}
      />
      <ErrorBox msg={px.error} />

      {/* Summary row — matched / discrepancy / one-sided at a glance */}
      <div className="row row-stats">
        <StatCard label="Total trades" value={r?.summary.total ?? '—'} sub="across both engines" />
        <StatCard
          label="Matched"
          value={r?.summary.matched ?? '—'}
          sub="within tolerance"
          tone="pos"
        />
        <StatCard
          label="Discrepancy"
          value={r?.summary.discrepancy ?? '—'}
          sub={r?.summary.discrepancy_severe ? `${r.summary.discrepancy_severe} severe` : 'out of tolerance'}
          tone={r?.summary.discrepancy ? (r?.summary.discrepancy_severe ? 'neg' : 'gold') : 'muted'}
        />
        <StatCard
          label="Live only"
          value={r?.summary.live_only ?? '—'}
          sub="not in liveref · 🔴"
          tone={r?.summary.live_only ? 'neg' : 'muted'}
        />
        <StatCard
          label="Liveref only"
          value={r?.summary.shadow_only ?? '—'}
          sub="live missed · 🔴"
          tone={r?.summary.shadow_only ? 'neg' : 'muted'}
        />
        <StatCard
          label="Pending"
          value={r?.summary.pending ?? '—'}
          sub="intra-bar · ref bar open"
          tone="muted"
        />
        {/* 2026-06-15 triangulation verdicts (3-way live | shadow | liveref) */}
        <StatCard
          label="Aligned"
          value={r?.summary.aligned ?? '—'}
          sub="all three agree"
          tone="pos"
        />
        <StatCard
          label="Liveref outlier"
          value={r?.summary.liveref_outlier ?? '—'}
          sub="publisher/convention drift"
          tone={r?.summary.liveref_outlier ? 'gold' : 'muted'}
        />
        <StatCard
          label="Exec drift"
          value={r?.summary.exec_drift ?? '—'}
          sub="live ≠ shadow daemon"
          tone={r?.summary.exec_drift ? 'neg' : 'muted'}
        />
        {/* 2026-06-23 (audit #61): off-script / off-book classes. off_script_* = breaches the
            tab was previously blind to; off_book = SANCTIONED off-reference reals (neutral). */}
        <StatCard
          label="Off-script exit"
          value={r?.summary.off_script_exit ?? '—'}
          sub="live closed · liveref holds · 🔴"
          tone={r?.summary.off_script_exit ? 'neg' : 'muted'}
        />
        <StatCard
          label="Off-script entry"
          value={r?.summary.off_script_entry ?? '—'}
          sub="live opened · not in liveref · 🔴"
          tone={r?.summary.off_script_entry ? 'neg' : 'muted'}
        />
        <StatCard
          label="Off-book"
          value={r?.summary.off_book ?? '—'}
          sub="sanctioned real · GRAM/TRX"
          tone="muted"
        />
      </div>

      {/* Tolerance banner — the thresholds that define matched vs discrepancy */}
      {r?.summary.tolerances && (
        <div className="adm-banner">
          <span className="bt-eyebrow" style={{ marginBottom: 0 }}>MATCH TOLERANCES</span>
          <span className="adm-banner-text num">
            timing ≤ {(r.summary.tolerances.time_ms / 1000).toFixed(0)}s
            {' · '}price ≤ {r.summary.tolerances.price_pct.toFixed(2)}%
            {'  (severe > '}{(r.summary.tolerances.severe_time_ms / 1000).toFixed(0)}s{' / '}{r.summary.tolerances.severe_price_pct.toFixed(2)}%)
            {r.summary.mean_entry_price_divergence_pct != null
              ? `  ·  mean entry Δ ${r.summary.mean_entry_price_divergence_pct.toFixed(3)}%`
              : ''}
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="adm-filter-row">
        <SubPills
          value={statusFilter}
          onChange={setStatusFilter}
          items={[
            { id: 'all', label: 'All', count: r?.summary.total ?? null },
            { id: 'matched', label: 'Matched', count: r?.summary.matched ?? null },
            { id: 'discrepancy', label: 'Discrepancy', count: r?.summary.discrepancy ?? null },
            { id: 'live_only', label: 'Live only', count: r?.summary.live_only ?? null },
            { id: 'shadow_only', label: 'Liveref only', count: r?.summary.shadow_only ?? null },
            { id: 'pending', label: 'Pending', count: r?.summary.pending ?? null },
            { id: 'off_script_exit', label: 'Off-script exit', count: r?.summary.off_script_exit ?? null },
            { id: 'off_script_entry', label: 'Off-script entry', count: r?.summary.off_script_entry ?? null },
            { id: 'off_book', label: 'Off-book', count: r?.summary.off_book ?? null },
          ]}
        />
        <select
          value={assetFilter}
          onChange={e => setAssetFilter(e.target.value)}
          className="settings-input adm-select"
          style={{ marginLeft: 'auto' }}
        >
          <option value="all">All assets</option>
          {PHASE_H_SYMS.map(s => (
            <option key={s} value={s}>{s.replace('USDT', '')}</option>
          ))}
        </select>
      </div>

      {/* Trade comparison table */}
      {!r || r.trades.length === 0 ? (
        <SectionCard title="TRADE LEDGER · LIVE | LIVEREF">
          <EmptyBox>
            {px.loading
              ? 'Loading…'
              : 'No trades in ledger yet. The comparison surface lights up on the first natural signal end-to-end.'}
          </EmptyBox>
        </SectionCard>
      ) : (
        <SectionCard title={`TRADE LEDGER · LIVE | LIVEREF · ${r.trades.length} entries`}>
          {/* 2026-06-06 redesign (Chris): one ROW PER ENGINE — a LIVE row
              (green) + a SHADOW row (grey) stacked per trade, then a Δ row with
              the entry/exit/SL/PnL/timing divergences. Lets him eyeball
              live-vs-shadow at a glance instead of decoding stacked cells.
              minWidth:0 + overflowX keeps it scrollable on narrow viewports. */}
          <div style={{ overflowX: 'auto', minWidth: 0, width: '100%' }}>
            <table className="adm-parity-table adm-parity-paired" style={{ minWidth: 1040 }}>
              <thead>
                <tr>
                  <th>Trade</th>
                  <th>Engine</th>
                  <th style={{ textAlign: 'right' }}>Entry px</th>
                  <th style={{ textAlign: 'right' }}>Entry time</th>
                  <th style={{ textAlign: 'right' }}>Exit px</th>
                  <th style={{ textAlign: 'right' }}>Exit time</th>
                  <th style={{ textAlign: 'right' }}>SL px</th>
                  <th style={{ textAlign: 'right' }}>PnL %</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {r.trades.map(row => <CompRow key={row.key} row={row} />)}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {r && (
        <div className="adm-footer-meta">
          As of <span className="num">{new Date(r.as_of_ms).toISOString().slice(0, 19).replace('T', ' ')}Z</span>
          {' · '}{fmtAge(r.as_of_ms)}
        </div>
      )}
    </div>
  )
}

// 2026-06-06 redesign: renders ONE ROW PER ENGINE — a LIVE row (green) + a
// SHADOW row (grey) + a Δ row (live−shadow divergences) — so live-vs-shadow is
// eyeballable per trade. Returns a fragment of <tr>s; the status/identity cell
// rowSpans the engine rows.
function CompRow({ row }: { row: CompRow }) {
  const sym = (row.symbol || row.asset + 'USDT').replace('USDT', '')
  const dir = row.live?.direction ?? row.shadow?.direction ?? 1
  const sideColor = dir === 1 ? 'var(--pos)' : 'var(--neg)'
  const side = dir === 1 ? 'LONG' : 'SHORT'

  // Status chip — matched=green, discrepancy=gold(minor)/red(severe), one-sided=red.
  const statusCfg: Record<string, { label: string; color: string; bg: string }> = {
    matched:     { label: 'MATCHED',     color: 'var(--pos)',  bg: 'rgba(46,204,113,0.05)' },
    discrepancy: { label: 'DISCREPANCY', color: row.severity === 'severe' ? 'var(--neg)' : 'var(--gold)',
                   bg: row.severity === 'severe' ? 'rgba(231,76,60,0.06)' : 'rgba(212,160,23,0.06)' },
    live_only:   { label: 'LIVE ONLY',   color: 'var(--neg)',  bg: 'rgba(231,76,60,0.07)' },
    shadow_only: { label: 'LIVEREF ONLY', color: 'var(--neg)',  bg: 'rgba(231,76,60,0.07)' },
    pending:     { label: 'PENDING',     color: '#8a94a6',     bg: 'rgba(138,148,166,0.05)' },
    // 2026-06-23 (audit #61): off-script breaches (red, alarming) + off-book (neutral grey).
    off_script_exit:  { label: 'OFF-SCRIPT EXIT',  color: 'var(--neg)', bg: 'rgba(231,76,60,0.10)' },
    off_script_entry: { label: 'OFF-SCRIPT ENTRY', color: 'var(--neg)', bg: 'rgba(231,76,60,0.10)' },
    off_book:         { label: 'OFF-BOOK',         color: '#8a94a6',    bg: 'rgba(138,148,166,0.05)' },
  }
  const sc = statusCfg[row.status] ?? statusCfg.matched

  // 2026-06-15 triangulation verdict badge — names which engine is the outlier.
  // aligned = all three agree; liveref_outlier = live=shadow≠liveref (publisher/
  // convention drift); exec_drift = live≠shadow (execution bug); one_sided/undefined = —.
  const verdictCfg: Record<string, { label: string; color: string }> = {
    aligned:         { label: '✓ ALIGNED',         color: 'var(--pos)' },
    liveref_outlier: { label: '⚠ LIVEREF OUTLIER', color: 'var(--gold)' },
    exec_drift:      { label: '⚠ EXEC DRIFT',      color: 'var(--neg)' },
    pending:         { label: '◷ PENDING',         color: '#8a94a6' },
    live_missing:    { label: '⚠ LIVE MISSING',    color: 'var(--gold)' },
    // 2026-06-23 (audit #61): off-script breaches name the direction (closed-too-soon vs
    // opened-uninstructed); off-book is sanctioned, neutral.
    off_script_exit:  { label: '⛔ OFF-SCRIPT EXIT',  color: 'var(--neg)' },
    off_script_entry: { label: '⛔ OFF-SCRIPT ENTRY', color: 'var(--neg)' },
    off_book:         { label: '◆ OFF-BOOK',          color: '#8a94a6' },
    one_sided:       { label: '—',                 color: '#9aa4b2' },
  }
  const vc = verdictCfg[row.verdict ?? 'one_sided'] ?? verdictCfg.one_sided

  // bar CLOSE (action time) = bar open + tf
  const TF_SEC: Record<string, number> = { '1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600,'2h':7200,'4h':14400,'6h':21600,'8h':28800,'12h':43200,'1d':86400 }
  const tfMs = (TF_SEC[row.tf] || 0) * 1000
  const barTs = row.entry_bar_ts + tfMs
  const barStr = barTs ? new Date(barTs).toISOString().slice(0, 16).replace('T', ' ') + 'Z' : '—'
  // 2026-06-16 (GRAM/TON remap): the cfg_sid embeds the PRE-remap asset token (V3G_TON_* trades
  // GRAM 1:1 post-Option-B), so deriving the label from the sid shows the stale "TON". Show the
  // RESOLVED current asset (row.asset, from the route's per-position metaFromKey) instead; fall
  // back to the sid token only when the asset can't be resolved (reference-only rows).
  const sidToken = (sid: string) => sid.replace(/^V3G_/, '').replace(/_[0-9a-f]+$/, '')
  const cfgShort = row.asset || sidToken(row.cfg_sid)
  // 2026-06-16 cfg PER ENGINE — the per-engine label tracks the same resolved asset; a cfg
  // mismatch (live ≠ liveref FCFS lane attribution) is still flagged by cfgClash (⚠) below and
  // the Δ-row CFG MISMATCH text (which carries the distinguishing hashes), so the asset label
  // no longer needs to embed the stale sid token.
  const cfgShortOf = (sid: string | null | undefined) =>
    sid ? (row.asset || sidToken(sid)) : null

  const d = row.divergence
  // 2026-06-29: SHADOW (paper-twin) column REMOVED — clean LIVE ⟷ LIVEREF comparison.
  // 2026-06-23 (audit #61): off_script_exit carries BOTH sides (live closed + liveref
  // still-open), so its Δ live·liveref row renders too — the operator sees the entry/exit
  // deltas of the position live closed off-script. The other new classes are one-sided.
  const hasLrDelta = !!(row.live && row.shadow && d)
  const paired = row.status === 'matched' || row.status === 'discrepancy' || row.status === 'off_script_exit'
  // 2 engine rows (LIVE / LIVEREF) always; + the Δ live·liveref row when available.
  const nRows = 2 + (paired && hasLrDelta ? 1 : 0)

  // SL Δ keeps a neutral magnitude scale (not in Chris's directional spec).
  const pctColor = (pct: number | null | undefined) =>
    pct == null ? 'var(--muted)'
      : Math.abs(pct) > 0.75 ? 'var(--neg)'
      : Math.abs(pct) > 0.15 ? 'var(--gold)'
      : 'var(--muted)'
  // 2026-06-08 (Chris) DIRECTION-AWARE Δ colours. dir = +1 long / −1 short.
  // entry px: live got a BETTER fill (lower long-entry / higher short-entry) → green,
  //   worse → yellow.  better ⇔ diff·dir < 0  (diff = (live−shadow)/shadow %).
  const entryPxColor = (pct: number | null | undefined) =>
    pct == null || Math.abs(pct) < 0.02 ? 'var(--muted)' : (pct * dir < 0 ? 'var(--pos)' : 'var(--gold)')
  // exit px: better exit (higher long-exit / lower short-exit) → green. better ⇔ diff·dir > 0.
  const exitPxColor = (pct: number | null | undefined) =>
    pct == null || Math.abs(pct) < 0.02 ? 'var(--muted)' : (pct * dir > 0 ? 'var(--pos)' : 'var(--gold)')
  // time: live LATER (ms>0) = worse for live → yellow; earlier → green; tiny → muted.
  const timeDirColor = (ms: number | null | undefined) =>
    ms == null || Math.abs(ms) < 5000 ? 'var(--muted)' : (ms > 0 ? 'var(--gold)' : 'var(--pos)')
  // pnl% Δ: favours live (≥0) → green, else red.
  const pnlDirColor = (pp: number | null | undefined) =>
    pp == null ? 'var(--muted)' : (pp >= 0 ? 'var(--pos)' : 'var(--neg)')
  const pctStr = (p: number | null | undefined) => p != null ? `${p >= 0 ? '+' : ''}${p.toFixed(3)}%` : '—'

  // per-engine cell renderers
  const pxCell = (s: TradeSide | null, field: 'entry_price' | 'exit_price' | 'sl_price') => {
    if (!s) return <span className="adm-stat-sub">—</span>
    const v = s[field]
    if (v != null && v > 0) return <>{fmtCompPx(v)}</>
    if (field === 'exit_price' && s.open) return <span style={{ color: 'var(--gold)', fontSize: 10 }}>open</span>
    return <span className="adm-stat-sub">—</span>
  }
  // 2026-06-08 (Chris): PnL = the PRICE-MOVE RETURN, % only, no $. (exit−entry)/
  // entry × direction — sizing-independent, so live and shadow compare on the same
  // scale and a 0.2% entry gap can't masquerade as a huge $ divergence (the old
  // pnl/balance bug). Open positions show 'open'.
  const pnlCell = (s: TradeSide | null) => {
    if (!s) return <span className="adm-stat-sub">—</span>
    if (s.exit_price != null && s.entry_price > 0) {
      const ret = (s.exit_price - s.entry_price) / s.entry_price * s.direction * 100
      return (
        <span style={{ color: ret >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
          {ret >= 0 ? '+' : ''}{ret.toFixed(2)}%
        </span>
      )
    }
    return <span className="adm-stat-sub">{s.open ? 'open' : '—'}</span>
  }
  // entry/exit fill time (UTC HH:MM:SS); `field` selects which timestamp.
  const timeCell = (s: TradeSide | null, field: 'entry_ts_ms' | 'exit_ts_ms') => {
    const v = s ? s[field] : null
    if (!s || v == null) return <span className="adm-stat-sub">{field === 'exit_ts_ms' && s?.open ? 'open' : '—'}</span>
    return <>{new Date(v).toISOString().slice(11, 19)}Z</>
  }
  const reasonCell = (s: TradeSide | null) =>
    !s ? <span className="adm-stat-sub">—</span>
      : <span className="adm-stat-sub" style={{ fontSize: 11 }}>{s.exit_reason ?? (s.open ? 'open' : '—')}</span>

  // Status/identity cell — rowSpans the engine rows
  const tradeCell = (
    <td rowSpan={nRows} style={{ background: sc.bg, borderLeft: `3px solid ${sc.color}`, verticalAlign: 'top' }}>
      <span style={{ color: sc.color, fontWeight: 800, fontSize: 11, whiteSpace: 'nowrap', letterSpacing: 0.3 }}>{sc.label}</span>
      {(row.status === 'discrepancy' || row.status === 'off_script_exit' || row.status === 'off_script_entry') && row.severity !== 'none' && (
        <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, color: row.severity === 'severe' ? 'var(--neg)' : 'var(--gold)', textTransform: 'uppercase' }}>{row.severity}</span>
      )}
      <div style={{ marginTop: 3 }}>
        <span className="num" style={{ fontWeight: 700 }}>{sym}</span>
        <span style={{ color: sideColor, fontSize: 10, fontWeight: 700, marginLeft: 6, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>{side}</span>
      </div>
      <div className="adm-stat-sub" style={{ fontSize: 10 }}>{cfgShort} · {row.tf}</div>
      <div className="adm-stat-sub" style={{ fontSize: 10, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>{row.cfg_sid}</div>
      <div className="adm-stat-sub" style={{ fontSize: 10 }}>{barStr} · {fmtAge(barTs)}</div>
      <div style={{ marginTop: 4 }}>
        <span style={{ color: vc.color, fontWeight: 800, fontSize: 9, letterSpacing: 0.3, whiteSpace: 'nowrap' }}>{vc.label}</span>
      </div>
    </td>
  )

  // one engine data row (LIVE green / SHADOW blue / LIVEREF grey) + its cfg_sid
  const engineRow = (label: string, color: string, bg: string, s: TradeSide | null, isFirst: boolean, cfgSid?: string | null) => {
    const cfgTxt = cfgShortOf(cfgSid)
    const cfgClash = !!cfgSid && cfgSid !== row.cfg_sid
    return (
    <tr style={{ background: bg }}>
      {isFirst && tradeCell}
      <td style={{ whiteSpace: 'nowrap' }}>
        <div>
          <span style={{ color, fontWeight: 700, fontSize: 11 }}>● {label}</span>
          {s?.open && <span style={{ fontSize: 9, color: 'var(--gold)', marginLeft: 4 }}>open</span>}
          {!s && <span className="adm-stat-sub" style={{ fontSize: 9, marginLeft: 4 }}>no trade</span>}
        </div>
        {cfgTxt && (
          <div style={{ fontSize: 9, fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: cfgClash ? 'var(--neg)' : '#7d8aa0', marginTop: 1 }}>
            {cfgTxt}{cfgClash ? ' ⚠' : ''}
          </div>
        )}
      </td>
      <td className="num" style={{ textAlign: 'right' }}>{pxCell(s, 'entry_price')}</td>
      <td className="num" style={{ textAlign: 'right', fontSize: 11 }}>{timeCell(s, 'entry_ts_ms')}</td>
      <td className="num" style={{ textAlign: 'right' }}>{pxCell(s, 'exit_price')}</td>
      <td className="num" style={{ textAlign: 'right', fontSize: 11 }}>{timeCell(s, 'exit_ts_ms')}</td>
      <td className="num" style={{ textAlign: 'right' }}>{pxCell(s, 'sl_price')}</td>
      <td className="num" style={{ textAlign: 'right' }}>{pnlCell(s)}</td>
      <td>{reasonCell(s)}</td>
    </tr>
    )
  }

  const dCell = (val: React.ReactNode, color: string) => (
    <td className="num" style={{ textAlign: 'right', fontSize: 10, color }}>{val}</td>
  )
  const secs = (ms: number | null | undefined) => ms != null ? `${ms >= 0 ? '+' : ''}${(ms / 1000).toFixed(0)}s` : '—'
  // SL Δ / exit-time Δ / pnl% Δ are computed from the actual pair being compared
  // (not carried in the divergence object), so each Δ row reflects its own two sides.
  const slDiff = (a: TradeSide | null, b: TradeSide | null) => {
    const x = a?.sl_price, y = b?.sl_price
    return (x != null && y != null && y) ? (x - y) / y * 100 : null
  }
  const exitTimeDiffOf = (a: TradeSide | null, b: TradeSide | null) =>
    (a?.exit_ts_ms != null && b?.exit_ts_ms != null) ? a.exit_ts_ms - b.exit_ts_ms : null
  // pnl% Δ from the SAME price-move return shown per engine (a − b), in pp.
  const sideRet = (s: TradeSide | null) =>
    (s && s.exit_price != null && s.entry_price > 0)
      ? (s.exit_price - s.entry_price) / s.entry_price * s.direction * 100 : null
  const pnlPctDiffOf = (a: TradeSide | null, b: TradeSide | null) => {
    const ar = sideRet(a), br = sideRet(b)
    return (ar != null && br != null) ? ar - br : null
  }

  // Δ row factory — `dv` is the divergence object, `a`/`b` the two compared sides.
  // `showCfg` enables the live-vs-liveref-only CFG-MISMATCH indicator.
  const mkDeltaRow = (
    label: string,
    dv: CompRow['divergence'] | CompRow['divergence_ls'] | null | undefined,
    a: TradeSide | null,
    b: TradeSide | null,
    showCfg: boolean,
  ) => {
    if (!dv) return null
    const slDiffPct = slDiff(a, b)
    const exitTimeDiff = exitTimeDiffOf(a, b)
    const pnlPctDiff = pnlPctDiffOf(a, b)
    return (
      <tr style={{ background: 'rgba(255,255,255,0.015)', borderBottom: '2px solid rgba(255,255,255,0.07)' }}>
        <td style={{ whiteSpace: 'nowrap' }}><span className="adm-stat-sub" style={{ fontSize: 10, fontWeight: 700 }}>{label}</span></td>
        {dCell(pctStr(dv.entry_price_diff_pct), entryPxColor(dv.entry_price_diff_pct))}
        {dCell(secs(dv.timing_diff_ms), timeDirColor(dv.timing_diff_ms))}
        {dCell(pctStr(dv.exit_price_diff_pct), exitPxColor(dv.exit_price_diff_pct))}
        {dCell(secs(exitTimeDiff), timeDirColor(exitTimeDiff))}
        {dCell(pctStr(slDiffPct), pctColor(slDiffPct))}
        {dCell(pnlPctDiff != null ? `${pnlPctDiff >= 0 ? '+' : ''}${pnlPctDiff.toFixed(2)}pp` : '—', pnlDirColor(pnlPctDiff))}
        <td>
          {showCfg && dv.cfg_mismatch ? (
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--neg)' }}>⚠ CFG MISMATCH — live {(row.cfg_sid.split('_').pop() || '').slice(0, 8)} ≠ shadow {((row.shadow_cfg_sid || '').split('_').pop() || '').slice(0, 8)}</span>
          ) : dv.eviction_mismatch ? (
            <span style={{ fontSize: 9, color: 'var(--neg)' }}>evict: {dv.eviction_mismatch}</span>
          ) : (dv.time_breach || dv.price_breach) ? (
            <span style={{ fontSize: 9, fontWeight: 700, color: dv.severity === 'severe' ? 'var(--neg)' : 'var(--gold)' }}>
              {[dv.time_breach ? 'timing' : null, dv.price_breach ? 'price' : null].filter(Boolean).join(' + ')} breach
            </span>
          ) : (
            <span className="adm-stat-sub" style={{ fontSize: 9, color: 'var(--pos)' }}>✓ in tolerance</span>
          )}
        </td>
      </tr>
    )
  }

  // LIVE-vs-LIVEREF (the published-canonical reference, kept on row.shadow).
  const deltaRowLr = (paired && hasLrDelta) ? mkDeltaRow('Δ live·liveref', d, row.live, row.shadow, true) : null

  return (
    <>
      {engineRow('LIVE', 'var(--pos)', 'rgba(46,204,113,0.06)', row.live, true, row.cfg_sid)}
      {engineRow('LIVEREF', '#9aa4b2', 'rgba(255,255,255,0.028)', row.shadow, false, row.shadow_cfg_sid ?? row.cfg_sid)}
      {deltaRowLr}
    </>
  )
}

function fmtCompPx(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 10000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n >= 100)   return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 1)     return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

function CoinDotMini({ sym }: { sym: string }) {
  const url: Record<string, string> = {
    BTC: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/btc.svg',
    ETH: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/eth.svg',
    XRP: 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/xrp.svg',
    SOL: '/coin-icons/sol.png',
    SUI: '/coin-icons/sui.png',
  }
  const src = url[sym]
  if (!src) return null
  return <img src={src} alt={sym} width={14} height={14} style={{ display: 'inline-block', borderRadius: '50%', verticalAlign: 'middle', marginRight: 4 }} />
}

// ────────────────────────────────────────────────────────────────────────────
// 3.5. System Health panel — Engine + Publisher + Cache + Watchdog roundup
// ────────────────────────────────────────────────────────────────────────────
//
// Added 2026-05-25 Session 2. Replaces V1's scattered health surfaces
// (deadman/feed/recon /tmp files) with one consolidated tab pulling from
// /api/admin/system-status. Refresh 30s.

type SystemStatus = {
  engine: {
    live: { pid: number | null; alive: boolean; uptime_min: number | null; state_age_min: number | null
            paused_global: boolean | null; g5b_disarmed: boolean | null; bot_net_pnl_usd: number | null
            per_tf_last_processed: Record<string, { open_ts: number; age_min: number | null }>
            cfg_count: number }
    shadow: { pid: number | null; alive: boolean; uptime_min: number | null; state_age_min: number | null
              per_tf_last_processed: Record<string, { open_ts: number; age_min: number | null }>
              cfg_count: number }
  }
  publisher: {
    halt_marker: string | null; halted: boolean
    consecutive_fails: number
    last_run_ts: number | null; last_run_kind: string | null; last_run_age_min: number | null
    last_pass_ts: number | null; last_pass_age_min: number | null
    last_fail_ts: number | null; last_fail_age_min: number | null
    relock_history: Array<{ date: string; reason: string; previous_baseline_archived: string }>
    runs_tail: string[]
  }
  cache: {
    total: number; stale_4h_plus: number; missing: number
    entries: Array<{ asset: string; tf: string; present: boolean; rows?: number
                     first_ts?: number; last_ts?: number; last_age_min?: number
                     mtime_ms?: number; mtime_age_min?: number; error?: string }>
  }
  watchdogs: {
    daemon_heartbeat: { name: string; last_run_ts: number | null; last_run_age_min: number | null
                       recent_alert: boolean; tail: string[] }
    pipeline_heartbeat: { name: string; last_run_ts: number | null; last_run_age_min: number | null
                          recent_alert: boolean; tail: string[] }
  }
  as_of_ms: number; fetched_in_ms: number
}

function SystemHealthPanel({ active }: { active: boolean }) {
  const fetcher = useCallback(async () => authedFetch<SystemStatus>('/api/admin/system-status'), [])
  const px = usePanelData<SystemStatus>(active, fetcher, 30_000)
  const r = px.data

  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="ADMIN · SYSTEM HEALTH"
        lead="Engine ·"
        accent="cache · publisher."
        blurb="Single-pane view of daemon state, parquet cache freshness, publisher cron health, and watchdog roundup. Refresh 30s."
        refreshing={px.loading}
        onRefresh={px.refresh}
      />
      <ErrorBox msg={px.error} />

      {/* ── ENGINE HEALTH ── */}
      <SectionCard title="ENGINE · LIVE vs SHADOW">
        {!r ? <EmptyBox>Loading…</EmptyBox> : (
          <div className="bt-twin-row">
            <DaemonCard
              name="Live"
              pid={r.engine.live.pid}
              alive={r.engine.live.alive}
              uptime_min={r.engine.live.uptime_min}
              state_age_min={r.engine.live.state_age_min}
              per_tf={r.engine.live.per_tf_last_processed}
              cfg_count={r.engine.live.cfg_count}
              extra={[
                { label: 'paused_global', value: String(r.engine.live.paused_global), tone: r.engine.live.paused_global ? 'neg' : 'pos' },
                { label: 'g5b_disarmed', value: String(r.engine.live.g5b_disarmed), tone: r.engine.live.g5b_disarmed ? 'gold' : 'muted' },
                { label: 'bot_net_pnl_usd', value: r.engine.live.bot_net_pnl_usd != null ? fmtUsd(r.engine.live.bot_net_pnl_usd, true) : '—', tone: 'muted' },
              ]}
            />
            <DaemonCard
              name="Shadow"
              pid={r.engine.shadow.pid}
              alive={r.engine.shadow.alive}
              uptime_min={r.engine.shadow.uptime_min}
              state_age_min={r.engine.shadow.state_age_min}
              per_tf={r.engine.shadow.per_tf_last_processed}
              cfg_count={r.engine.shadow.cfg_count}
              extra={[]}
            />
          </div>
        )}
      </SectionCard>

      {/* ── PUBLISHER STATUS ── */}
      <SectionCard title="PUBLISHER · phase-i-publisher cron">
        {!r ? <EmptyBox>Loading…</EmptyBox> : (
          <>
            <div className="row row-stats">
              <StatCard
                label="Last run"
                value={r.publisher.last_run_kind || '—'}
                sub={r.publisher.last_run_age_min != null ? `${r.publisher.last_run_age_min}m ago` : 'never'}
                tone={r.publisher.last_run_kind === 'PASS' ? 'pos' : r.publisher.last_run_kind === 'FAIL' ? 'neg' : 'muted'}
              />
              <StatCard
                label="HALT marker"
                value={r.publisher.halted ? 'PRESENT' : 'absent'}
                sub={r.publisher.halted ? r.publisher.halt_marker?.slice(0, 60) || '' : 'clear'}
                tone={r.publisher.halted ? 'neg' : 'pos'}
              />
              <StatCard
                label="Consecutive fails"
                value={r.publisher.consecutive_fails}
                sub={r.publisher.consecutive_fails === 0 ? 'clean' : 'recent failures'}
                tone={r.publisher.consecutive_fails === 0 ? 'pos' : 'neg'}
              />
              <StatCard
                label="Last PASS"
                value={r.publisher.last_pass_age_min != null ? `${r.publisher.last_pass_age_min}m` : 'never'}
                sub="ago"
                tone={r.publisher.last_pass_age_min != null && r.publisher.last_pass_age_min < 90 ? 'pos' : 'muted'}
              />
            </div>
            {r.publisher.relock_history.length > 0 && (
              <div className="adm-banner" style={{ marginTop: 12 }}>
                <span className="bt-eyebrow" style={{ marginBottom: 0 }}>RELOCK HISTORY · {r.publisher.relock_history.length} entries</span>
                <span className="adm-banner-text" style={{ fontSize: 11 }}>
                  Latest: {new Date(r.publisher.relock_history[r.publisher.relock_history.length - 1].date).toISOString().slice(0, 19).replace('T', ' ')}Z
                </span>
              </div>
            )}
            <details style={{ marginTop: 12 }}>
              <summary className="adm-stat-sub" style={{ cursor: 'pointer' }}>Recent runs.log tail ({r.publisher.runs_tail.length} lines)</summary>
              <pre className="adm-log-tail" style={{ marginTop: 8 }}>{r.publisher.runs_tail.join('\n')}</pre>
            </details>
          </>
        )}
      </SectionCard>

      {/* ── CACHE INTEGRITY ── */}
      <SectionCard title={`CACHE INTEGRITY · ${r ? r.cache.total : '—'} (asset, TF) pairs`}>
        {!r ? <EmptyBox>Loading…</EmptyBox> : (
          <>
            <div className="row row-stats" style={{ marginBottom: 12 }}>
              <StatCard label="Total" value={r.cache.total} sub="16 assets × 7 TFs" />
              <StatCard label="Stale ≥ 4h" value={r.cache.stale_4h_plus} tone={r.cache.stale_4h_plus > 0 ? 'gold' : 'pos'} />
              <StatCard label="Missing" value={r.cache.missing} tone={r.cache.missing > 0 ? 'neg' : 'pos'} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="adm-parity-table">
                <thead>
                  <tr><th>Asset</th>{['1h','2h','4h','6h','8h','12h','1d'].map(tf => <th key={tf}>{tf}</th>)}</tr>
                </thead>
                <tbody>
                  {Array.from(new Set(r.cache.entries.map(e => e.asset))).map(asset => (
                    <tr key={asset}>
                      <td className="num" style={{ fontWeight: 700 }}>{asset}</td>
                      {['1h','2h','4h','6h','8h','12h','1d'].map(tf => {
                        const e = r.cache.entries.find(x => x.asset === asset && x.tf === tf)
                        if (!e || !e.present) return <td key={tf} style={{ color: 'var(--neg)' }}>—</td>
                        const age = e.last_age_min ?? 999999
                        const color = age > 4 * 60 ? 'var(--neg)' : age > 60 ? 'var(--gold)' : 'var(--pos)'
                        return (
                          <td key={tf} style={{ color, fontSize: 11 }}>
                            {age < 60 ? `${age}m` : age < 1440 ? `${Math.floor(age/60)}h` : `${Math.floor(age/1440)}d`}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="adm-stat-sub" style={{ fontSize: 10, marginTop: 8 }}>
              Cell value = age of last bar in cache. Green &lt;60m, yellow 60m–4h, red &gt;4h. Some TFs legitimately update less often (1d only daily).
            </div>
          </>
        )}
      </SectionCard>

      {/* ── WATCHDOG ROUNDUP ── */}
      <SectionCard title="WATCHDOGS">
        {!r ? <EmptyBox>Loading…</EmptyBox> : (
          <div className="bt-twin-row">
            <WatchdogCard w={r.watchdogs.daemon_heartbeat} />
            <WatchdogCard w={r.watchdogs.pipeline_heartbeat} />
          </div>
        )}
      </SectionCard>

      {r && (
        <div className="adm-footer-meta">
          As of <span className="num">{new Date(r.as_of_ms).toISOString().slice(0, 19).replace('T', ' ')}Z</span>
          {' · '}fetched in <span className="num">{r.fetched_in_ms}ms</span>
        </div>
      )}
    </div>
  )
}

function DaemonCard({ name, pid, alive, uptime_min, state_age_min, per_tf, cfg_count, extra }: {
  name: string; pid: number | null; alive: boolean; uptime_min: number | null
  state_age_min: number | null; per_tf: Record<string, { open_ts: number; age_min: number | null }>
  cfg_count: number; extra: Array<{ label: string; value: string; tone: 'pos'|'neg'|'gold'|'muted' }>
}) {
  return (
    <SectionCard title={`${name.toUpperCase()} DAEMON`}>
      <div className="row row-stats" style={{ marginBottom: 12 }}>
        <StatCard
          label="Status"
          value={alive ? 'ALIVE' : 'DOWN'}
          sub={pid ? `PID ${pid}` : 'no PID'}
          tone={alive ? 'pos' : 'neg'}
        />
        <StatCard
          label="Uptime"
          value={uptime_min != null ? (uptime_min < 60 ? `${uptime_min}m` : `${Math.floor(uptime_min/60)}h ${uptime_min%60}m`) : '—'}
          sub="since restart"
          tone="muted"
        />
        <StatCard
          label="state.json age"
          value={state_age_min != null ? `${state_age_min}m` : '—'}
          sub="last persist"
          tone={state_age_min != null && state_age_min < 90 ? 'pos' : state_age_min != null && state_age_min < 130 ? 'gold' : 'neg'}
        />
        <StatCard
          label="cfgs loaded"
          value={cfg_count}
          sub="total in state"
          tone="muted"
        />
      </div>
      {extra.length > 0 && (
        <div className="adm-feed-grid" style={{ marginBottom: 12 }}>
          {extra.map((e, i) => (
            <div key={i} className="adm-feed-cell">
              <div className="adm-feed-head"><span className="num" style={{ fontWeight: 600, fontSize: 11 }}>{e.label}</span></div>
              <div className="adm-feed-meta" style={{ color: e.tone === 'pos' ? 'var(--pos)' : e.tone === 'neg' ? 'var(--neg)' : e.tone === 'gold' ? 'var(--gold)' : 'var(--muted)' }}>{e.value}</div>
            </div>
          ))}
        </div>
      )}
      <div className="adm-stat-sub" style={{ fontSize: 10, marginBottom: 4 }}>Last processed bar by TF (age in minutes):</div>
      <div className="adm-feed-grid">
        {['1h','2h','4h','6h','8h','12h','1d'].map(tf => {
          const v = per_tf[tf]
          if (!v) return <div key={tf} className="adm-feed-cell"><div className="adm-feed-head"><span className="num">{tf}</span></div><div className="adm-feed-meta">—</div></div>
          const age = v.age_min ?? 999999
          // Each TF's expected oscillation peak ≈ 2× its interval
          const tf_max: Record<string, number> = { '1h': 130, '2h': 250, '4h': 490, '6h': 730, '8h': 970, '12h': 1450, '1d': 2890 }
          const limit = tf_max[tf] ?? 130
          const color = age > limit ? 'var(--neg)' : age > limit * 0.8 ? 'var(--gold)' : 'var(--pos)'
          return (
            <div key={tf} className="adm-feed-cell">
              <div className="adm-feed-head"><span className="num" style={{ fontWeight: 600 }}>{tf}</span></div>
              <div className="adm-feed-meta" style={{ color }}>{age < 60 ? `${age}m` : `${Math.floor(age/60)}h ${age%60}m`}</div>
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

function WatchdogCard({ w }: { w: SystemStatus['watchdogs']['daemon_heartbeat'] }) {
  return (
    <SectionCard title={w.name.toUpperCase().replace(/_/g, ' ')}>
      <div className="row row-stats" style={{ marginBottom: 12 }}>
        <StatCard
          label="Last run"
          value={w.last_run_age_min != null ? `${w.last_run_age_min}m ago` : 'never'}
          sub={w.last_run_ts ? new Date(w.last_run_ts).toISOString().slice(11, 19) + 'Z' : ''}
          tone={w.last_run_age_min != null && w.last_run_age_min < 20 ? 'pos' : w.last_run_age_min != null && w.last_run_age_min < 60 ? 'gold' : 'neg'}
        />
        <StatCard
          label="Recent alert"
          value={w.recent_alert ? 'yes' : 'no'}
          sub={w.recent_alert ? 'check tail' : 'all clean'}
          tone={w.recent_alert ? 'gold' : 'pos'}
        />
      </div>
      <details>
        <summary className="adm-stat-sub" style={{ cursor: 'pointer' }}>Last 8 log lines</summary>
        <pre className="adm-log-tail" style={{ marginTop: 8, fontSize: 10 }}>{w.tail.join('\n')}</pre>
      </details>
    </SectionCard>
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
          {al.data?.total ?? 0} total
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
// 6. Users panel — sub-tabs for users / brokers
// (Waitlist sub-tab removed 2026-05-09 — waitlist gating decommissioned;
//  signup is open. WaitlistList component below kept dead in case a quick
//  re-enable is needed but no longer rendered.)
// ────────────────────────────────────────────────────────────────────────────

function UsersPanel({ active }: { active: boolean }) {
  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="ADMIN · COMMUNITY"
        lead="Paying"
        accent="users."
        blurb="Roster of paying users. Search, paginate, drill down. Broker-program partners live under the Broker section."
      />
      <UsersList active={active} />
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


type BrokersResp = {
  applications: Array<{ broker_email?: string; referral_code?: string; split_pct?: number; referred_count?: number; total_earned_usd?: number; total_owed_usd?: number; total_paid_usd?: number; approved_at?: string }>
  total?: number; active?: number; referred_users?: number; total_earnings?: number; total_owed?: number; total_paid?: number
}

function BrokersPanel({ active }: { active: boolean }) {
  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="ADMIN · BROKER"
        lead="Broker"
        accent="partners."
        blurb="Broker-program partners — referral code, split tier, referred users, lifetime earned, currently owed, paid out."
      />
      <BrokersList active={active} />
    </div>
  )
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
        <StatCard label="Earned (lifetime)" value={fmtUsd(b.data?.total_earnings ?? null)} tone="gold" />
        <StatCard label="Owed (open)" value={fmtUsd(b.data?.total_owed ?? null)} tone="gold" />
        <StatCard label="Paid (lifetime)" value={fmtUsd(b.data?.total_paid ?? null)} tone="pos" />
      </div>
      <SectionCard title="BROKER PARTNERS">
        {(b.data?.applications || []).length === 0 ? <EmptyBox>No brokers.</EmptyBox> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="adm-table">
              <thead><tr>
                <th>Broker</th><th>Code</th>
                <th style={{ textAlign: 'right' }}>Tier</th>
                <th style={{ textAlign: 'right' }}>Referred</th>
                <th style={{ textAlign: 'right' }}>Earned</th>
                <th style={{ textAlign: 'right' }}>Owed</th>
                <th style={{ textAlign: 'right' }}>Paid</th>
                <th>Approved</th>
              </tr></thead>
              <tbody>
                {b.data!.applications.map((row, i) => (
                  <tr key={i}>
                    <td className="adm-truncate" style={{ maxWidth: 240 }}>{row.broker_email || '—'}</td>
                    <td className="num" style={{ color: 'var(--muted)' }}>{row.referral_code || '—'}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{(row.split_pct ?? 25) + '%'}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{row.referred_count ?? 0}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{fmtUsd(row.total_earned_usd, false, 2)}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{fmtUsd(row.total_owed_usd, false, 2)}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{fmtUsd(row.total_paid_usd, false, 2)}</td>
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
// 7. Revenue panel — top-level revenue ledger only. Invoices + payouts moved
// to the Broker section.
// ────────────────────────────────────────────────────────────────────────────

function RevenuePanel({ active }: { active: boolean }) {
  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="ADMIN · REVENUE"
        lead="MRR and"
        accent="performance fees."
        blurb="Subscription revenue + performance fees. 30-day rolling unless noted. Broker payouts and invoice ledger live under the Broker section."
      />
      <RevenueList active={active} />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 7b. Broker invoices panel — promoted from a Revenue sub-tab.
// ────────────────────────────────────────────────────────────────────────────

function BrokerInvoicesPanel({ active }: { active: boolean }) {
  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="ADMIN · BROKER"
        lead="Client"
        accent="invoices."
        blurb="Subscription + performance-fee invoices billed to broker-referred clients. Each invoice with a referral_code drives a broker split."
      />
      <InvoicesList active={active} />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 7c. Broker payouts panel — promoted from a Revenue sub-tab.
// ────────────────────────────────────────────────────────────────────────────

function BrokerPayoutsPanel({ active }: { active: boolean }) {
  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="ADMIN · BROKER"
        lead="Broker"
        accent="payouts."
        blurb="Payout ledger per broker. Pending = owed, paid = settled to broker wallet."
      />
      <PayoutsList active={active} />
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
        eyebrow="ADMIN · BROKER"
        lead="Company crypto"
        accent="wallets."
        blurb="Receiving addresses for invoice settlement, and outbound addresses for broker payouts. Per-network."
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
// 9. Strategy panel — sub-tabs for Research / Spec / Optimizations / Architecture
// ────────────────────────────────────────────────────────────────────────────

type StratSub = 'swingmate' | 'bob' | 'staxs'

function StrategyPanel({ active }: { active: boolean }) {
  // SwingMate ⚡ = single-cfg leaderboard (cross-asset post Phase G, 200k+ swept).
  // BoB = qualifying-edge single cfgs. Best Staxs 🥞 = stack leaderboard (Phase F/2/4).
  const [sub, setSub] = useState<StratSub>('swingmate')
  return (
    <div className="stax-page">
      <PageHeader
        eyebrow="ADMIN · STRATEGY"
        lead="Strategy mining —"
        accent="SwingMate ⚡ + Best of The Best + Best Staxs."
        blurb="SwingMate ⚡: top-10k cross-asset single-cfg sweep (BTC + 7 alts, ~200k swept). BoB: top-500 qualifying-edge cfgs (WR≥60 AND PF≥1.5) OR (Total≥50% AND beats HODL). Best Staxs 🥞: top-100 stacks across Phase F + Phase 2 (partial-TP) + Phase 4 (super-stack)."
      />
      <SubPills
        value={sub}
        onChange={setSub}
        items={[
          { id: 'swingmate', label: 'SwingMate ⚡' },
          { id: 'bob', label: 'Best of The Best 🏆' },
          { id: 'staxs', label: 'Best Staxs 🥞' },
        ]}
      />
      <div style={{ display: sub === 'swingmate' ? 'block' : 'none' }}>
        <StrategyResearchPanel active={active && sub === 'swingmate'} source="swingmate" displayName="SwingMate ⚡" />
      </div>
      <div style={{ display: sub === 'bob' ? 'block' : 'none' }}>
        <StrategyResearchPanel active={active && sub === 'bob'} source="bob" displayName="Best of The Best 🏆 — Stacks" />
      </div>
      <div style={{ display: sub === 'staxs' ? 'block' : 'none' }}>
        <BestStaxsPanel active={active && sub === 'staxs'} />
      </div>

      {/* 2026-05-25 (Session 3): inline re-lock history. Visible across all
          strategy sub-tabs since baselines are global, not sub-tab specific.
          Read-only, sourced from PHASE_H_BASELINE.json's relock_history. */}
      <RelockHistorySection active={active} />
    </div>
  )
}

type RelockHistoryResp = {
  relock_history: Array<{ date: string; reason: string; previous_baseline_archived: string }>
  current_locked: any
  total: number
}

function RelockHistorySection({ active }: { active: boolean }) {
  const fetcher = useCallback(async () => authedFetch<RelockHistoryResp>('/api/admin/relock-history'), [])
  const rh = usePanelData<RelockHistoryResp>(active, fetcher, 5 * 60_000) // 5min — re-locks are rare events
  return (
    <SectionCard title={`PHASE H BASELINE · RE-LOCK HISTORY · ${rh.data?.total ?? 0}`}>
      {!rh.data ? <EmptyBox>{rh.loading ? 'Loading…' : 'No baseline data.'}</EmptyBox> : (
        <div className="adm-kvlist">
          {rh.data.relock_history.length === 0 ? (
            <EmptyBox>No re-locks recorded. First re-lock will populate here.</EmptyBox>
          ) : (
            rh.data.relock_history.map((r, i) => (
              <div key={i} className="adm-kv" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4, paddingTop: 8, paddingBottom: 8, borderBottom: i < rh.data!.relock_history.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span className="num" style={{ fontSize: 11, fontWeight: 700 }}>
                    {new Date(r.date).toISOString().slice(0, 19).replace('T', ' ')}Z
                  </span>
                  <span style={{ color: 'var(--muted)', fontSize: 10 }}>{fmtAge(r.date)}</span>
                </div>
                <div style={{ color: 'var(--text)', fontSize: 11, lineHeight: 1.4 }}>{r.reason}</div>
                {r.previous_baseline_archived && (
                  <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
                    archived → {r.previous_baseline_archived}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
      <div className="adm-stat-sub" style={{ fontSize: 10, marginTop: 8 }}>
        Per-re-lock metric deltas vs prior baseline deferred until 2nd real re-lock cycle (today's entries are recovery-sequence within the same window).
      </div>
    </SectionCard>
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
