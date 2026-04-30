'use client'

import { useEffect, useState } from 'react'
import { Antenna, HeartPulse, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react'

/**
 * Pipeline-health cards. Client component: fetches /api/admin/system-health
 * on mount and every 30 seconds (live, not just on page load).
 *
 * Renders three cards side-by-side:
 *   1. Feed Health   — 5-asset basket CSV freshness
 *   2. Deadman       — backtest output freshness + position state
 *   3. Reconciliation — DB ↔ exchange parity
 *
 * Each card can be in three states:
 *   - LOADING (spinner)
 *   - HEALTHY (green border)
 *   - DEGRADED (amber/rose border, with explanation)
 */

type FeedAsset = {
  symbol: string
  lastIso: string | null
  lagMs: number | null
  lagPretty: string
  stale: boolean
}

type SystemHealth = {
  ts: number
  feed: { data: { assets: FeedAsset[]; stale: any[] } | null; monitorAgeMs: number | null; missing: boolean }
  deadman: { data: any; monitorAgeMs: number | null; missing: boolean }
  recon: { data: any; monitorAgeMs: number | null; missing: boolean }
}

function ageStr(ms: number | null) {
  if (ms == null) return 'no data'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function HealthCards() {
  const [data, setData] = useState<SystemHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  async function load() {
    try {
      const r = await fetch('/api/admin/system-health', { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setData(j)
      setErr(null)
    } catch (e: any) {
      setErr(e.message || 'load failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 30 * 1000)
    return () => clearInterval(t)
  }, [])

  if (loading) {
    return <Skeleton />
  }
  if (err || !data) {
    return (
      <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-4 text-rose-300 text-sm">
        Failed to load pipeline health: {err}
      </div>
    )
  }

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <FeedCard section={data.feed} />
      <DeadmanCard section={data.deadman} />
      <ReconCard section={data.recon} />
    </div>
  )
}

function Skeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {[0, 1, 2].map(i => (
        <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5 animate-pulse">
          <div className="h-4 w-32 bg-zinc-800 rounded mb-3" />
          <div className="h-3 w-full bg-zinc-800/70 rounded mb-2" />
          <div className="h-3 w-3/4 bg-zinc-800/70 rounded" />
        </div>
      ))}
    </div>
  )
}

function FeedCard({ section }: { section: SystemHealth['feed'] }) {
  if (section.missing) {
    return (
      <Card title="Feed health" icon={Antenna} tone="rose"
        meta="monitor offline">
        <div className="text-sm text-rose-300">
          <strong>Monitor offline.</strong> <code className="bg-zinc-800/60 px-1.5 py-0.5 rounded">/tmp/staxs-feed-status.json</code> missing.
          <div className="mt-2 text-xs text-zinc-500">
            Run <code className="bg-zinc-800/60 px-1.5 py-0.5 rounded">pm2 restart feed-freshness-monitor</code>.
          </div>
        </div>
      </Card>
    )
  }
  const data: any = section.data || {}
  const assets: FeedAsset[] = data.assets || []
  const staleCount = (data.stale || []).length
  const monitorStale = (section.monitorAgeMs || 0) > 5 * 60 * 1000
  const tone: Tone = monitorStale ? 'rose' : staleCount > 0 ? 'amber' : 'emerald'

  return (
    <Card
      title="Feed health"
      icon={Antenna}
      tone={tone}
      titleSuffix={
        <span className={`ml-2 font-mono text-[11px] ${tone === 'emerald' ? 'text-emerald-400' : 'text-amber-400'}`}>
          {assets.length - staleCount} / {assets.length} healthy
        </span>
      }
      meta={`monitor ${ageStr(section.monitorAgeMs)}`}
    >
      {monitorStale && (
        <div className="mb-3 px-3 py-2 rounded border border-rose-500/40 bg-rose-500/10 text-xs text-rose-200">
          ⚠️ Status file is {ageStr(section.monitorAgeMs)} old — monitor may be stuck.
        </div>
      )}
      <div className="grid grid-cols-5 gap-1.5">
        {assets.map(a => {
          const sym = a.symbol.replace('USDT', '')
          const stale = a.stale
          return (
            <div
              key={a.symbol}
              className={`rounded border px-2.5 py-2 ${stale
                ? 'border-rose-500/40 bg-rose-500/5'
                : 'border-emerald-500/25 bg-emerald-500/[0.03]'}`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${stale ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                <span className="font-mono text-xs font-semibold">{sym}</span>
              </div>
              <div className="mt-1 text-[10px] text-zinc-500 font-mono">
                lag <span className={stale ? 'text-rose-300' : 'text-zinc-300'}>{a.lagPretty}</span>
              </div>
            </div>
          )
        })}
      </div>
      <Footer>5-asset basket · stale threshold = 12 min</Footer>
    </Card>
  )
}

function DeadmanCard({ section }: { section: SystemHealth['deadman'] }) {
  if (section.missing) {
    return (
      <Card title="Deadman switch" icon={ShieldCheck} tone="rose" meta="heartbeat missing">
        <div className="text-sm text-rose-300">
          Heartbeat file missing. Run <code className="bg-zinc-800/60 px-1.5 py-0.5 rounded">pm2 restart deadman-switch</code>.
        </div>
      </Card>
    )
  }
  const data: any = section.data || {}
  const lc = data.lastCheck || {}
  const fr = lc.freshness || {}
  const pending = lc.pending || {}
  const stale = (section.monitorAgeMs || 0) > 2 * 60 * 1000
  const issues = lc.issues || 0
  const tone: Tone = stale ? 'rose' : issues > 0 ? 'amber' : 'emerald'
  const status = stale ? 'STALE' : issues > 0 ? `${issues} ISSUE${issues === 1 ? '' : 'S'}` : 'OK'

  return (
    <Card
      title="Deadman switch"
      icon={ShieldCheck}
      tone={tone}
      titleSuffix={<Pill tone={tone}>{status}</Pill>}
      meta={`heartbeat ${ageStr(section.monitorAgeMs)}`}
    >
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-zinc-500">Backtest output</dt>
        <dd className={`font-mono ${fr.fresh ? 'text-emerald-400' : 'text-rose-400'}`}>
          {fr.fresh ? `${fr.age || 0}s old` : 'STALE'}
        </dd>
        {fr.state && (
          <>
            <dt className="text-zinc-500">Position</dt>
            <dd className={`font-mono ${fr.state.open ? 'text-amber-400' : 'text-zinc-300'}`}>
              {fr.state.open ? (fr.state.side || 'OPEN') : 'flat'}
              {fr.state.open && fr.state.pyramided ? ' · pyramided' : ''}
            </dd>
          </>
        )}
        <dt className="text-zinc-500">Pending signal</dt>
        <dd className={`font-mono ${pending.stale ? 'text-rose-400' : 'text-zinc-300'}`}>
          {pending.stale ? `STALE (${pending.age || 0}m)` : 'none'}
        </dd>
        <dt className="text-zinc-500">Issues raised</dt>
        <dd className={`font-mono ${issues > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{issues}</dd>
      </dl>
      <Footer>stale threshold = 15 min · checks every 60s</Footer>
    </Card>
  )
}

function ReconCard({ section }: { section: SystemHealth['recon'] }) {
  if (section.missing) {
    return (
      <Card title="Reconciliation" icon={RefreshCw} tone="zinc" meta="no status yet">
        <div className="text-sm text-zinc-500">
          No reconciliation file yet. Engine may not have run.
        </div>
      </Card>
    )
  }
  const data: any = section.data || {}
  const issues = data.issues || 0
  const stale = (section.monitorAgeMs || 0) > 5 * 60 * 1000
  const tone: Tone = stale ? 'amber' : issues > 0 ? 'rose' : 'emerald'
  const status = stale ? 'STALE' : issues > 0 ? `${issues} ISSUE${issues === 1 ? '' : 'S'}` : 'OK'
  const details: string[] = Array.isArray(data.details) ? data.details : []

  return (
    <Card
      title="Reconciliation"
      icon={RefreshCw}
      tone={tone}
      titleSuffix={<Pill tone={tone}>{status}</Pill>}
      meta={`last run ${ageStr(section.monitorAgeMs)}`}
    >
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-zinc-500">Users checked</dt>
        <dd className="font-mono">{data.usersChecked ?? '?'}</dd>
        <dt className="text-zinc-500">Orphans / mismatches</dt>
        <dd className={`font-mono ${issues > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{issues}</dd>
        {data.backtestState && (
          <>
            <dt className="text-zinc-500">Backtest position</dt>
            <dd className="font-mono">
              {data.backtestState.open ? 'open' : 'flat'}
              {data.backtestState.scalp ? ' (scalp)' : ''}
            </dd>
          </>
        )}
      </dl>
      {issues > 0 && details.length > 0 && (
        <div className="mt-3 p-2.5 rounded border border-rose-500/30 bg-rose-500/5 text-xs">
          {details.slice(0, 3).map((d, i) => (
            <div key={i} className="text-rose-300 leading-relaxed">• {d}</div>
          ))}
          {details.length > 3 && (
            <div className="text-zinc-500">…and {details.length - 3} more</div>
          )}
        </div>
      )}
      <Footer>DB ↔ exchange parity check</Footer>
    </Card>
  )
}

// ─── Card primitives ────────────────────────────────────────────────────

type Tone = 'emerald' | 'amber' | 'rose' | 'zinc'

function Card({
  title, icon: Icon, tone = 'zinc', titleSuffix, meta, children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  tone?: Tone
  titleSuffix?: React.ReactNode
  meta?: string
  children: React.ReactNode
}) {
  const borderTone = {
    emerald: 'border-emerald-500/30',
    amber: 'border-amber-500/40',
    rose: 'border-rose-500/40',
    zinc: 'border-zinc-800',
  }[tone]
  return (
    <section className={`rounded-lg border ${borderTone} bg-zinc-900/30 p-5`}>
      <div className="flex items-start justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Icon className="w-4 h-4 text-cyan-400" />
          {title}
          {titleSuffix}
        </h2>
        {meta && <div className="text-[10px] text-zinc-500 font-mono">{meta}</div>}
      </div>
      {children}
    </section>
  )
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const cls = {
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    rose: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    zinc: 'bg-zinc-700/30 text-zinc-300 border-zinc-700',
  }[tone]
  const dot = {
    emerald: 'bg-emerald-400',
    amber: 'bg-amber-400',
    rose: 'bg-rose-400',
    zinc: 'bg-zinc-400',
  }[tone]
  return (
    <span className={`ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  )
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 text-[10px] text-zinc-500 font-mono">{children}</div>
}
