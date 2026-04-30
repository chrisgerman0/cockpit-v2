import Link from 'next/link'
import { ArrowRight, ShieldAlert, TrendingUp, BarChart3 } from 'lucide-react'

/**
 * Dashboard home — placeholder. Real implementation comes after the
 * Admin showcase is reviewed and signed off.
 */
export default function DashboardHome() {
  return (
    <div className="px-8 py-10 max-w-6xl">
      <h1 className="text-2xl font-bold mb-1">Welcome back</h1>
      <p className="text-sm text-zinc-500 mb-8">
        Cockpit v2 · this is the new dashboard, running parallel to the existing one.
        Admin Overview is the showcase page — everything else is a stub for now.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <PreviewLink href="/admin"       icon={ShieldAlert} title="Admin Overview" sub="Pipeline + business at a glance" tone="rose" />
        <PreviewLink href="/live"        icon={TrendingUp}  title="Live Trading"   sub="Coming soon" />
        <PreviewLink href="/backtesting" icon={BarChart3}   title="Backtesting"    sub="Coming soon" />
      </div>

      <div className="mt-8 p-4 rounded-lg border border-zinc-800 bg-zinc-900/40 text-xs text-zinc-500 leading-relaxed">
        <strong className="text-zinc-300">What you&apos;re looking at:</strong> a fresh Next.js app at port
        3007. Same Supabase project, same auth, same backend APIs.
        Everything you currently use stays untouched at <code className="bg-zinc-800/60 px-1 rounded">staxs.ai/client-dashboard.html</code>.
        We migrate sections here one at a time, ship them when verified, and only flip the sidebar
        link in the old app once a section is at full parity.
      </div>
    </div>
  )
}

function PreviewLink({
  href, icon: Icon, title, sub, tone,
}: { href: string; icon: any; title: string; sub: string; tone?: 'rose' }) {
  const accent = tone === 'rose' ? 'text-rose-400' : 'text-amber-400'
  return (
    <Link
      href={href}
      className="group border border-zinc-800/80 hover:border-zinc-700 rounded-lg p-5 bg-zinc-900/30 transition-colors flex items-start gap-3"
    >
      <Icon className={`w-5 h-5 mt-0.5 ${accent}`} />
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <span className="font-medium">{title}</span>
          <ArrowRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
        </div>
        <div className="text-xs text-zinc-500 mt-1">{sub}</div>
      </div>
    </Link>
  )
}
