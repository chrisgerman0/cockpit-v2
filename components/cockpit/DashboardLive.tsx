'use client'

import { useStaxDashboardData } from '@/lib/use-stax-dashboard-data'
import { StaxDashboardContent, LOADING_STAX_DATA } from './stax/StaxDashboard'

/**
 * Live dashboard — fetches user balance, bot config, trades, public tickers,
 * and renders Claude Design's StaxDashboardContent with real numbers.
 * The surrounding shell (sidebar + topbar + ticker) lives in the layout.
 *
 * States: loading (blank shell — no fake numbers) / unauthenticated /
 * no-keys / no-bot / ready / error.
 *
 * The 3-step OnboardingBanner is rendered above every authed state until
 * step3_complete (banner self-hides). Mounts in no-keys / no-bot / ready
 * so the user always has a visible "what comes next" affordance — matches
 * the legacy client-dashboard.html behaviour.
 */
export function DashboardLive() {
  const state = useStaxDashboardData()

  // Render the shell instantly with em-dashes / zeros so the layout doesn't
  // shift when real data lands. Critically, no fake balances/positions/trades
  // — users were getting confused seeing "BTCUSDT LONG 0.2500 @ $65,432.10"
  // for ~500ms on every refresh and assuming it was their account.
  if (state.status === 'loading') {
    return <StaxDashboardContent data={LOADING_STAX_DATA} />
  }

  if (state.status === 'unauthenticated') {
    return <CenterMessage title="Sign in to see your dashboard" body="Your trading data is private — log in at staxs.ai to load it here." action={{ label: 'Go to login', href: 'https://staxs.ai/login' }} />
  }
  if (state.status === 'error') {
    return <CenterMessage title="Couldn’t load your dashboard" body={state.message} />
  }

  // no-keys / no-bot / ready all render the same dashboard now. The hook
  // populates user-specific fields with safe defaults (no real balance, no
  // user trades) and fills strategy-derived fields (equity curve, recent
  // trades fallback, win rate) from the backtest portfolio so the user can
  // see the strategy at work BEFORE they connect anything. The
  // OnboardingBanner above the dashboard tells them the next step.
  return <StaxDashboardContent data={state.data} />
}

function CenterMessage({ title, body, action }: { title: string; body: string; action?: { label: string; href: string } }) {
  return (
    <div style={{ padding: '64px 24px', textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>{title}</h2>
      <p style={{ marginTop: 8, fontSize: 14, color: 'var(--muted)' }}>{body}</p>
      {action ? (
        <a
          href={action.href}
          style={{
            marginTop: 18,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid rgba(212,160,23,0.35)',
            background: 'rgba(212,160,23,0.08)',
            color: 'var(--gold)',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >{action.label}</a>
      ) : null}
    </div>
  )
}
