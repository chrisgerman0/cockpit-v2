import { Activity, Users, Rocket, Bell, ShieldAlert } from 'lucide-react'
import { HealthCards } from '@/components/health-cards'

/**
 * Admin Overview — showcase page. Stat tiles are placeholders (real values
 * will land when auth is wired and we can talk to Supabase). Health cards
 * pull from /api/admin/system-health which is also temporarily ungated.
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function AdminOverview() {
  return (
    <div className="px-8 py-8 max-w-7xl">
      <div className="flex items-end justify-between mb-1">
        <h1 className="text-2xl font-bold">Admin Overview</h1>
        <span className="text-[11px] font-mono text-zinc-500">cockpit v2 preview</span>
      </div>
      <p className="text-sm text-zinc-500 mb-6">
        Pipeline + business snapshot. Health cards refresh every 30 seconds.
      </p>

      {/* Stat tiles — values are placeholder until auth is wired */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatTile label="Open positions"     value="0"  icon={Rocket}     tone="emerald" />
        <StatTile label="Pending fills"      value="0"  icon={Activity}   tone="amber" />
        <StatTile label="Unresolved alerts"  value="0"  icon={Bell}       tone="zinc" />
        <StatTile label="Total users"        value="—"  icon={Users}      tone="zinc" />
      </div>

      <h2 className="text-xs uppercase tracking-wider text-zinc-500 mt-8 mb-3 flex items-center gap-2">
        <ShieldAlert className="w-3.5 h-3.5" />
        Pipeline health
      </h2>
      <HealthCards />

      <div className="mt-10 p-4 rounded-lg border border-zinc-800 bg-zinc-900/40 text-xs text-zinc-500 leading-relaxed">
        <strong className="text-zinc-300">Cockpit v2 · showcase preview.</strong> Auth gate is
        temporarily off so the UI is reviewable. Stat tile numbers will populate once auth is
        wired; the three health cards already pull live from the same status files the v1 cockpit
        reads.
      </div>
    </div>
  )
}

function StatTile({
  label, value, icon: Icon, tone = 'zinc',
}: {
  label: string
  value: number | string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'emerald' | 'amber' | 'rose' | 'zinc'
}) {
  const cls = {
    emerald: 'border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300',
    amber:   'border-amber-500/30 hover:border-amber-500/50 text-amber-300',
    rose:    'border-rose-500/30 hover:border-rose-500/50 text-rose-300',
    zinc:    'border-zinc-800 hover:border-zinc-700 text-zinc-100',
  }[tone]
  return (
    <div className={`border rounded-lg p-5 bg-zinc-900/30 transition-colors flex items-center justify-between ${cls}`}>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{label}</div>
        <div className="text-3xl font-bold tabular-nums">{value}</div>
      </div>
      <Icon className="w-7 h-7 opacity-60" />
    </div>
  )
}
