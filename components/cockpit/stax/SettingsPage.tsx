'use client'

/**
 * Settings page — 6 tabs cloned from v1 client-dashboard.html section-settings:
 *   profile · billing · bot · notifications · security · payout
 *
 * Tab is selected via ?tab=<id> URL param so the topbar hamburger menu can
 * deep-link straight to a sub-page. Profile + Bot read live data via existing
 * APIs; Bot is read-only (configuration done via the v1 wizard for now —
 * porting the 5-step wizard is a separate ~6h job).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Icons } from './Icons'
import { useT } from '@/lib/i18n'
import { browserClient } from '@/lib/supabase-browser'
import { authedFetch } from '@/lib/api'

type TabId = 'profile' | 'billing' | 'bot' | 'notifications' | 'security' | 'payout'

const TABS: Array<{ id: TabId; tKey: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'profile',       tKey: 'settings.profile',       icon: Icons.Robot   /* placeholder; user icon */ },
  { id: 'billing',       tKey: 'settings.billing',       icon: Icons.Briefcase },
  { id: 'bot',           tKey: 'settings.bot',           icon: Icons.Robot },
  { id: 'notifications', tKey: 'settings.notifications', icon: Icons.Bell },
  { id: 'security',      tKey: 'settings.security',      icon: Icons.Shield },
  { id: 'payout',        tKey: 'settings.payout',        icon: Icons.Briefcase },
]

export function SettingsContent() {
  const t = useT()
  const search = useSearchParams()
  const router = useRouter()

  const tabFromUrl = (search?.get('tab') || 'profile') as TabId
  const [tab, setTab] = useState<TabId>(
    TABS.find(t => t.id === tabFromUrl) ? tabFromUrl : 'profile'
  )

  useEffect(() => {
    const next = (search?.get('tab') || 'profile') as TabId
    if (TABS.find(x => x.id === next) && next !== tab) setTab(next)
  }, [search])

  function selectTab(id: TabId) {
    setTab(id)
    router.replace(`/settings?tab=${id}`, { scroll: false })
  }

  return (
    <div className="settings-wrap">
      <h1 className="settings-title">{t('settings.title')}</h1>
      <div className="settings-grid">
        <nav className="settings-nav" aria-label="Settings navigation">
          {TABS.map(tb => {
            const Ico = tb.icon
            return (
              <button
                key={tb.id}
                onClick={() => selectTab(tb.id)}
                className={'settings-tab' + (tab === tb.id ? ' active' : '')}
                type="button"
              >
                <Ico size={16} />
                <span>{t(tb.tKey)}</span>
              </button>
            )
          })}
        </nav>
        {/* All panels stay mounted — toggling display instead of conditional
            render means switching tabs is instant (no useEffect refetch).
            Mirrors v1 client-dashboard.html which keeps all .settings-panel
            divs in the DOM and just flips display:none/block. */}
        <div className="settings-panel"><div style={{ display: tab === 'profile'       ? 'block' : 'none' }}><ProfilePanel /></div>
        <div style={{ display: tab === 'billing'       ? 'block' : 'none' }}><BillingPanel /></div>
        <div style={{ display: tab === 'bot'           ? 'block' : 'none' }}><BotPanel /></div>
        <div style={{ display: tab === 'notifications' ? 'block' : 'none' }}><NotificationsPanel /></div>
        <div style={{ display: tab === 'security'      ? 'block' : 'none' }}><SecurityPanel /></div>
        <div style={{ display: tab === 'payout'        ? 'block' : 'none' }}><PayoutPanel /></div></div>
      </div>
    </div>
  )
}

// ─── Profile ────────────────────────────────────────────────────────────────

function ProfilePanel() {
  const t = useT()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [origName, setOrigName] = useState('')
  const [target, setTarget] = useState('1')
  const [origTarget, setOrigTarget] = useState('1')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const sb = browserClient()
        const { data } = await sb.auth.getUser()
        if (cancelled || !data.user) return
        const meta = (data.user.user_metadata || {}) as any
        setEmail(data.user.email || '')
        const dn = meta.display_name || meta.full_name || ''
        setName(dn); setOrigName(dn)
        const mt = String(Number(meta.mission_target_btc) > 0 ? meta.mission_target_btc : 1)
        setTarget(mt); setOrigTarget(mt)
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])

  const dirty = name !== origName || target !== origTarget

  async function save() {
    if (!dirty || saving) return
    setSaving(true)
    try {
      const sb = browserClient()
      await sb.auth.updateUser({
        data: {
          display_name: name,
          mission_target_btc: Number(target) || 1,
        },
      })
      setOrigName(name); setOrigTarget(target)
      setSavedAt(Date.now())
    } catch (e) {
      // Silent fail — keep dirty state so user can retry
    } finally {
      setSaving(false)
    }
  }

  const justSaved = savedAt && Date.now() - savedAt < 2000

  return (
    <div className="card card-pad settings-card">
      <h3 className="settings-card-title">{t('settings.profile')}</h3>
      <div className="settings-form">
        <Field label={t('profile.email')}>
          <input type="email" value={email} readOnly className="settings-input" />
        </Field>
        <Field label={t('profile.displayName')}>
          <input
            type="text"
            value={name}
            placeholder={t('profile.namePlaceholder')}
            onChange={e => setName(e.target.value)}
            className="settings-input"
          />
        </Field>
        <Field label={t('profile.missionTarget')} help={t('profile.missionHelp')}>
          <input
            type="number"
            min="0.1"
            step="0.01"
            value={target}
            onChange={e => setTarget(e.target.value)}
            className="settings-input"
            style={{ maxWidth: 220 }}
          />
        </Field>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="settings-btn-primary"
        >
          {justSaved ? t('profile.saved') : t('profile.save')}
        </button>
      </div>
    </div>
  )
}

// ─── Billing ────────────────────────────────────────────────────────────────
// Pulls /api/billing which returns the user's current plan (Performance / 20%
// perf-fee, or Subscription / $100 flat), the OPEN billing period with live
// realised PnL + estimated fee, and history of past periods.

type BillingPlan = {
  id: string
  name: string
  type: 'performance' | 'flat'
  priceCents: number
  perfFeePct: number
  minBalanceCents: number
}

type BillingPeriod = {
  id: string
  startTs: string
  endTs: string
  status: 'open' | 'locked' | 'invoiced' | 'paid' | 'failed'
  startingBalanceCents: number
  endingBalanceCents: number | null
  grossPnlCents: number
  feeAmountCents: number
  netAfterFeeCents: number
  tradeCount?: number
}

type BillingHistoryEntry = {
  id: string
  startTs: string
  endTs: string
  status: string
  planName: string
  grossPnlCents: number
  feeAmountCents: number
  stripeStatus?: string
}

type BillingData = {
  plan: BillingPlan | null
  currentPeriod: BillingPeriod | null
  history: BillingHistoryEntry[]
  profile?: { isVip?: boolean; isBroker?: boolean }
}

// Same formatters as v1 client-dashboard.html — signed prefix on PnL, abs on
// fee/charge cells, en-GB date for "01 May 2026", en-US for "May 2026".
const fmtCents = (cents: number | null | undefined) => {
  if (cents == null) return '—'
  const val = Math.abs(cents) / 100
  const prefix = cents < 0 ? '-' : cents > 0 ? '+' : ''
  return prefix + '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const fmtCentsAbs = (cents: number | null | undefined) => {
  if (cents == null) return '—'
  return '$' + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
const fmtMonthYear = (ts: string | null | undefined) => {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Empty default — page renders instantly against this; real data swaps in.
const EMPTY_BILLING: BillingData = {
  plan: null,
  currentPeriod: null,
  history: [],
  profile: { isVip: false, isBroker: false },
}

function BillingPanel() {
  // Render the v1-faithful billing layout instantly with empty values, swap
  // in real data when /api/billing resolves. No 'Loading…' card.
  const [data, setData] = useState<BillingData>(EMPTY_BILLING)

  // Initial load + 60s poll + reload on tab-focus so PnL stays current as
  // trades close. Period roll-overs are server-driven; the panel just reads.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const j = await authedFetch<BillingData>('/api/billing')
        if (!cancelled) setData(j)
      } catch { /* silent — keep current state */ }
    }
    load()
    const timer = setInterval(load, 60_000)
    function onFocus() { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const plan = data.plan
  const cp = data.currentPeriod
  const isVip = !!data.profile?.isVip
  const isPerf = plan?.type === 'performance'

  // Plan card content — verbatim copy from v1 client-dashboard.html
  // window._loadBillingSettings(). Same conditionals, same copy.
  const planName = !plan
    ? 'No Plan Selected'
    : isVip
      ? 'Performance Plan — Partner Account'
      : `${plan.name} Plan`

  const planBadge = !plan ? (
    <span className="bp-badge bp-badge-neg">Not Active</span>
  ) : isVip ? (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      <span className="bp-badge bp-badge-gold">{plan.perfFeePct}% Performance Fee</span>
      <span className="bp-badge bp-badge-locked">🔒 Locked</span>
    </span>
  ) : plan.type === 'flat' ? (
    <span className="bp-badge bp-badge-pos">${plan.priceCents / 100}/mo</span>
  ) : (
    <span className="bp-badge bp-badge-gold">{plan.perfFeePct}% Performance Fee</span>
  )

  const planDetails = !plan ? (
    isVip
      ? 'Your Performance Plan is being set up — please contact support if this persists.'
      : 'Select a plan to start trading.'
  ) : isVip ? (
    <>Partner account — enrolled in Performance Plan. {plan.perfFeePct}% fee on realized profits.<br />Plan is fixed and cannot be changed.</>
  ) : plan.type === 'flat' ? (
    <>Fixed monthly subscription. No performance fees apply.<br />Your trading profits are 100% yours.</>
  ) : (
    <>
      No monthly subscription. {plan.perfFeePct}% fee on realized profits per billing period.
      <br />If a period is negative, you pay nothing. Each period stands on its own.
      {(plan as any).lockedUntil ? <><br /><span style={{ color: 'var(--muted)', fontSize: 11 }}>Plan locked until {fmtDate((plan as any).lockedUntil)}</span></> : null}
    </>
  )

  // Status pill — same labels/colours as v1 #billingPeriodDates2.
  const statusPill = !cp ? null : (() => {
    const map: Record<string, { lbl: string; cls: string }> = {
      open:     { lbl: '● Active',    cls: 'bp-status-open' },
      locked:   { lbl: '🔒 Locked',   cls: 'bp-status-locked' },
      invoiced: { lbl: '📧 Invoiced', cls: 'bp-status-invoiced' },
      paid:     { lbl: '✅ Paid',     cls: 'bp-status-paid' },
    }
    const m = map[cp.status] || { lbl: cp.status, cls: 'bp-status-locked' }
    return <span className={'bp-period-status ' + m.cls}>{m.lbl}</span>
  })()

  // 6-cell metrics grid — verbatim labels/order from v1.
  const periodCells = cp ? [
    { label: 'Starting Balance', value: fmtCentsAbs(cp.startingBalanceCents), tone: 'text' as const },
    { label: 'Trades This Period', value: String(cp.tradeCount ?? 0), tone: 'text' as const },
    { label: 'Realized PnL', value: fmtCents(cp.grossPnlCents), tone: cp.grossPnlCents >= 0 ? 'pos' as const : 'neg' as const },
    {
      label: isPerf ? `Performance Fee (${plan?.perfFeePct}%)` : 'Fee',
      value: isPerf ? fmtCentsAbs(cp.feeAmountCents) : '$0.00',
      tone: cp.feeAmountCents > 0 ? 'gold' as const : 'muted' as const,
    },
    { label: 'Net After Fee', value: fmtCents(cp.netAfterFeeCents), tone: cp.netAfterFeeCents >= 0 ? 'pos' as const : 'neg' as const },
    {
      label: isPerf && cp.status === 'open' ? 'Estimated Charge' : 'Final Charge',
      value: cp.feeAmountCents > 0 ? fmtCentsAbs(cp.feeAmountCents) : '$0.00',
      tone: cp.feeAmountCents > 0 ? 'neg' as const : 'muted' as const,
    },
  ] : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="bp-header">
        <div>
          <h2 className="bp-title">Billing</h2>
          <p className="bp-subtitle">Your plan, fees, and billing history</p>
        </div>
        {isVip ? <span className="bp-vip-badge">⭐ VIP CLIENT</span> : null}
      </div>

      {/* Current Plan card */}
      <div className="card card-pad bp-card">
        <div className="bp-plan-head">
          <div>
            <div className="bp-eyebrow">Current Plan</div>
            <div className="bp-plan-name">{planName}</div>
          </div>
          <div>{planBadge}</div>
        </div>
        <div className="bp-plan-details">{planDetails}</div>
      </div>

      {/* Current Billing Period card */}
      <div className="card card-pad bp-card">
        <div className="bp-eyebrow">Current Billing Period</div>
        {!cp ? (
          <>
            <div className="bp-period-dates">No active billing period</div>
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>
              Select a plan to start your first billing period
            </div>
          </>
        ) : (
          <>
            <div className="bp-period-dates">
              {fmtMonthYear(cp.startTs)}{statusPill}
            </div>
            <div className="bp-period-grid">
              {periodCells.map((c, i) => (
                <div key={i} className="bp-cell">
                  <div className="bp-cell-label">{c.label}</div>
                  <div className={'bp-cell-val num bp-tone-' + c.tone}>{c.value}</div>
                </div>
              ))}
            </div>
            {isPerf ? (
              <div className="bp-fee-explainer">
                {cp.grossPnlCents > 0 ? (
                  <>
                    💡 <strong>How your fee is calculated:</strong> {plan?.perfFeePct}% of your realized profit for this billing period.<br />
                    Profit: {fmtCents(cp.grossPnlCents)} × {plan?.perfFeePct}% = <strong>{fmtCentsAbs(cp.feeAmountCents)}</strong>
                    {cp.status === 'open' ? <><br /><em>This is an estimate. Final fee is locked at period close.</em></> : null}
                  </>
                ) : (
                  <>💡 This period has no realized profit, so <strong>no performance fee</strong> applies. Each billing period is independent — past losses don't carry forward.</>
                )}
              </div>
            ) : plan?.type === 'flat' ? (
              <div className="bp-fee-explainer">
                💡 You're on the <strong>Subscription</strong> plan (${plan.priceCents / 100}/mo). No performance fees — your profits are 100% yours. Subscription is billed separately via Stripe.
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* VIP Financial Summary (broker-referred users only) */}
      {isVip && cp ? (
        <div className="card card-pad bp-card bp-vip-summary">
          <div className="bp-eyebrow bp-eyebrow-gold">⭐ VIP Financial Summary</div>
          <div className="bp-vip-grid">
            <VipCell label="Current Period Profit" value={fmtCents(cp.grossPnlCents)} tone={cp.grossPnlCents >= 0 ? 'pos' : 'neg'} />
            <VipCell label="Our Fee" value={cp.feeAmountCents > 0 ? fmtCentsAbs(cp.feeAmountCents) : '$0.00'} tone="gold" />
            <VipCell label="Your Net" value={fmtCents(cp.netAfterFeeCents)} tone={cp.netAfterFeeCents >= 0 ? 'pos' : 'neg'} />
          </div>
        </div>
      ) : null}

      {/* Billing History table — Period / Plan / PnL / Fee / Net / Status */}
      <div className="card card-pad bp-card">
        <div className="bp-eyebrow">Billing History</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="bp-history">
            <thead>
              <tr>
                <th>Period</th>
                <th>Plan</th>
                <th style={{ textAlign: 'right' }}>PnL</th>
                <th style={{ textAlign: 'right' }}>Fee</th>
                <th style={{ textAlign: 'right' }}>Net</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.history.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>No billing history yet</td></tr>
              ) : data.history.map(h => {
                const net = h.grossPnlCents - h.feeAmountCents
                const labels: Record<string, string> = { open: 'Active', locked: 'Locked', invoiced: 'Invoiced', paid: 'Paid', failed: 'Failed' }
                return (
                  <tr key={h.id}>
                    <td>{fmtMonthYear(h.startTs)}</td>
                    <td style={{ color: 'var(--muted)' }}>{h.planName || '—'}</td>
                    <td className={'num ' + (h.grossPnlCents >= 0 ? 'pos-text' : 'neg-text')} style={{ textAlign: 'right' }}>{fmtCents(h.grossPnlCents)}</td>
                    <td className="num" style={{ textAlign: 'right', color: h.feeAmountCents > 0 ? 'var(--gold)' : 'var(--muted)' }}>
                      {h.feeAmountCents > 0 ? fmtCentsAbs(h.feeAmountCents) : '$0'}
                    </td>
                    <td className={'num ' + (net >= 0 ? 'pos-text' : 'neg-text')} style={{ textAlign: 'right' }}>{fmtCents(net)}</td>
                    <td><span className={'bp-status-dot bp-status-dot-' + h.status} />{labels[h.status] || h.status}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function VipCell({ label, value, tone }: { label: string; value: string; tone: 'pos' | 'neg' | 'gold' }) {
  return (
    <div className="bp-vip-cell">
      <div className="bp-vip-cell-label">{label}</div>
      <div className={'bp-vip-cell-val num bp-tone-' + tone}>{value}</div>
    </div>
  )
}


// ─── Bot ────────────────────────────────────────────────────────────────────
// Reads /api/bot-activate (GET) → { activated, config } sourced from Supabase
// auth.users.user_metadata.bot_config (the canonical place since 2026-05-01).
// This is NOT the same as /api/bot-config which reads bot_assignments — that
// table holds legacy/observed sizing data, not the activation truth.
//
// Tier change posts to /api/bot-activate (POST) — server runs Bitget
// pre-flight (leverage cap check) + margin headroom guard before persisting.

type BotConfig = {
  preset?: 'conservative' | 'bold' | 'aggressive'
  tier?: 'conservative' | 'bold' | 'aggressive'
  leverage?: number
  capital?: number
  activation_balance?: number
  hb_base_notional_usd?: number
  notional?: number
  compound?: boolean
  smart_sizing_enabled?: boolean
  updatedAt?: string
}

const TIER_LEVERAGE: Record<'conservative' | 'bold' | 'aggressive', number> = {
  conservative: 4,
  bold: 10,
  aggressive: 20,
}

// Tier ratios — V1 canonical (matches lib/tier-sizing.ts on staxs-landing).
// position size = capital × tierMult; SL = 4% of entry across the basket.
const TIER_RATIOS = {
  conservative: { mult: 0.5, leverage: 4,  sl: 4, label: 'Conservative', blurb: 'Smaller positions. Smoother ride.', recommended: true },
  bold:         { mult: 1.0, leverage: 10, sl: 4, label: 'Bold',         blurb: 'Benchmark sizing. Same logic, full exposure.', recommended: false },
  aggressive:   { mult: 1.5, leverage: 20, sl: 4, label: 'Aggressive',   blurb: 'Bigger swings. Same logic, more risk.', recommended: false },
} as const
type TierKey = keyof typeof TIER_RATIOS

function BotPanel() {
  const t = useT()
  // Render content instantly with empty defaults — real values swap in when
  // /api/bot-activate resolves. No 'Loading…' guard.
  const [cfg, setCfg] = useState<BotConfig | null>(null)
  const [activated, setActivated] = useState(false)
  const [view, setView] = useState<'summary' | 'wizard'>('summary')

  const loadConfig = useCallback(async () => {
    try {
      const j = await authedFetch<{ activated: boolean; config: BotConfig | null }>('/api/bot-activate')
      setCfg(j?.config || null)
      setActivated(!!j?.activated)
    } catch { /* silent — keep zero state */ }
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  const tier = (cfg?.tier || cfg?.preset || 'conservative') as TierKey
  const lev = cfg?.leverage || TIER_RATIOS[tier].leverage
  const capital = cfg?.activation_balance || cfg?.capital
  const notional = cfg?.hb_base_notional_usd || cfg?.notional

  const tierLabel = ({
    conservative: t('bot.tierConservative'),
    bold: t('bot.tierBold'),
    aggressive: t('bot.tierAggressive'),
  } as any)[tier] || t('bot.tierConservative')

  if (view === 'wizard') {
    return (
      <BotSettingsWizard
        initialTier={tier}
        initialCapital={Number(capital) || 0}
        initialCompound={!!cfg?.compound}
        onClose={() => setView('summary')}
        onSaved={async () => { await loadConfig(); setView('summary') }}
      />
    )
  }

  return (
    <div className="card card-pad settings-card">
      <h3 className="settings-card-title">{t('bot.title')}</h3>
      <div className="bot-summary">
        <BotRow label={t('bot.status')} value={
          <span className={activated ? 'pos-text' : 'neg-text'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {activated ? <span className="dot-live" /> : null}
            {activated ? t('bot.active') : t('bot.notActivated')}
          </span>
        } />
        <BotRow label={t('bot.tier')} value={<span className="bot-tier-pill">{tierLabel}</span>} />
        <BotRow label={t('bot.leverage')} value={`${lev}×`} />
        {capital ? <BotRow label="Capital" value={`$${Number(capital).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} /> : null}
        {notional ? <BotRow label={t('bot.notional')} value={`$${Number(notional).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} /> : null}
      </div>

      <div style={{ borderTop: '1px solid var(--line)', marginTop: 22, paddingTop: 16 }}>
        <div className="settings-help" style={{ marginBottom: 8 }}>
          {activated ? 'Reconfigure your tier, capital, or compound mode.' : 'Configure your tier and activate the bot.'}
        </div>
        <button
          type="button"
          className="settings-btn-primary"
          onClick={() => setView('wizard')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          {activated ? 'Reconfigure bot' : t('bot.openWizard')}
        </button>
      </div>
    </div>
  )
}

// ─── Bot Settings Wizard ────────────────────────────────────────────────────
// 5-step inline wizard ported from v1 client-dashboard.html (#bwStep1..#bwStep5).
//   1. Choose Trading Mode (Conservative / Bold / Aggressive)
//   2. Set Capital (with Refresh Balance from /api/balance)
//   3. How Sizing Works + Compound mode toggle
//   4. 12-Month Projection (concise — backtest stats per tier)
//   5. Review & Activate (POSTs to /api/bot-activate)
//
// Tier multipliers (TIER_RATIOS): 0.5× / 1.0× / 1.5× of balance.
// SL is 4% across all tiers. Bitget leverage cap is set per tier (4/10/20×).

// Backtest stats per tier — all from the 8-year Satoshi Stacker portfolio.
// Win rate / total trades / profit factor / months profitable are tier-
// independent (same strategy on every asset). Returns + drawdown + avg
// win/loss scale with the tier multiplier.
const TIER_BACKTEST = {
  conservative: { totalReturnPct: 4009 * 0.5, annualPct: 452 * 0.5, maxDdPct: 8.7,  avgWinPct: 7.2 * 0.5, avgLossPct: 2.1 * 0.5, winRatePct: 80.9, profitFactor: 4.74, totalTrades: 860, riskPos: 10 },
  bold:         { totalReturnPct: 4009,       annualPct: 452,       maxDdPct: 17.4, avgWinPct: 7.2,       avgLossPct: 2.1,       winRatePct: 80.9, profitFactor: 4.74, totalTrades: 860, riskPos: 40 },
  aggressive:   { totalReturnPct: 4009 * 1.5, annualPct: 452 * 1.5, maxDdPct: 26.1, avgWinPct: 7.2 * 1.5, avgLossPct: 2.1 * 1.5, winRatePct: 80.9, profitFactor: 4.74, totalTrades: 860, riskPos: 75 },
} as const

// ─── Projected equity curve (synthetic, tier-scaled exponential growth) ──
// Generates a smooth-ish curve from $start capital to $start × (1 + totalReturnPct/100)
// over 8 years of monthly points. Matches the v1 wizard's mini equity chart.
function ProjectedEquityCurve({ startCapital, totalReturnPct }: { startCapital: number; totalReturnPct: number }) {
  const points = 96 // 8 years × 12 months
  const endCapital = startCapital * (1 + totalReturnPct / 100)
  // Pseudo-random for slight wobble — deterministic so re-renders don't twitch.
  let s = Math.round(totalReturnPct)
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
  // Exponential growth ratio per period.
  const r = Math.pow(endCapital / startCapital, 1 / (points - 1))
  const vals: number[] = []
  let v = startCapital
  for (let i = 0; i < points; i++) {
    v *= r
    // ±3% wobble
    const wobble = 1 + (rand() - 0.5) * 0.06
    vals.push(v * wobble)
  }
  // Force final value to exactly endCapital so the curve ends where labelled.
  vals[vals.length - 1] = endCapital

  const W = 760
  const H = 160
  const pad = { l: 56, r: 12, t: 10, b: 22 }
  const min = Math.min(...vals) * 0.95
  const max = Math.max(...vals) * 1.05
  const xAt = (i: number) => pad.l + (i / (vals.length - 1)) * (W - pad.l - pad.r)
  const yAt = (val: number) => pad.t + (1 - (val - min) / (max - min)) * (H - pad.t - pad.b)

  // 5 y-axis ticks
  const ticks = 5
  const yTicks = Array.from({ length: ticks }, (_, i) => min + ((max - min) * i) / (ticks - 1))
  const fmtY = (v: number) => {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(0)}M`
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
    return `$${v.toFixed(0)}`
  }

  // 5 x-axis labels — quarterly milestones across the 8 years
  const startDate = new Date()
  startDate.setFullYear(startDate.getFullYear() - 8)
  const xLabels = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const d = new Date(startDate)
    d.setMonth(d.getMonth() + Math.floor(f * (points - 1)))
    return { i: Math.floor(f * (points - 1)), label: d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/,/g, '') }
  })

  // Smooth path
  const path = vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(2)} ${yAt(v).toFixed(2)}`).join(' ')
  const areaPath = path + ` L ${xAt(vals.length - 1)} ${H - pad.b} L ${xAt(0)} ${H - pad.b} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 160, display: 'block' }}>
      <defs>
        <linearGradient id="bw-eq-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(212,160,23,0.28)" />
          <stop offset="100%" stopColor="rgba(212,160,23,0.02)" />
        </linearGradient>
      </defs>
      {/* gridlines + y-labels */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={yAt(t)} y2={yAt(t)} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 4" />
          <text x={pad.l - 8} y={yAt(t) + 3} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="JetBrains Mono, monospace">{fmtY(t)}</text>
        </g>
      ))}
      {/* area + line */}
      <path d={areaPath} fill="url(#bw-eq-grad)" />
      <path d={path} fill="none" stroke="var(--gold)" strokeWidth="2" />
      {/* x-labels */}
      {xLabels.map((xl, i) => (
        <text key={i} x={xAt(xl.i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'} fontSize="10" fill="var(--muted)" fontFamily="JetBrains Mono, monospace">{xl.label}</text>
      ))}
    </svg>
  )
}

function BotSettingsWizard({
  initialTier, initialCapital, initialCompound, onClose, onSaved,
}: {
  initialTier: TierKey
  initialCapital: number
  initialCompound: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [preset, setPreset] = useState<TierKey>(initialTier)
  const [capital, setCapital] = useState<string>(initialCapital ? String(Math.round(initialCapital)) : '10000')
  const [maxBalance, setMaxBalance] = useState<number>(0)
  const [fetchingBalance, setFetchingBalance] = useState(false)
  const [exchangeConnected, setExchangeConnected] = useState(true)
  const [showProjected, setShowProjected] = useState(false)
  const [compound, setCompound] = useState(initialCompound)
  const [activating, setActivating] = useState(false)
  const [activateMsg, setActivateMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const ratios = TIER_RATIOS[preset]
  const bt = TIER_BACKTEST[preset]
  const capNum = Math.max(0, Number(capital) || 0)
  const posSize = capNum * ratios.mult
  const maxLoss = posSize * (ratios.sl / 100)
  const overBalance = maxBalance > 0 && capNum > maxBalance

  async function fetchBalance() {
    setFetchingBalance(true)
    try {
      const j = await authedFetch<{ equity?: number; available?: number; error?: string }>('/api/balance')
      // 'no api keys' style error → exchange not yet connected.
      if (j?.error && /no api keys|unauthorized|missing/i.test(j.error)) {
        setExchangeConnected(false)
      } else {
        setExchangeConnected(true)
        const eq = Number(j?.equity || j?.available || 0)
        if (eq > 0) {
          setMaxBalance(eq)
          setCapital(String(Math.round(eq)))
        }
      }
    } catch (e: any) {
      // 401 from authedFetch → not authenticated yet, not the same as no keys.
      const m = String(e?.message || '')
      if (/401|404|NO[_-]?KEYS|no api keys/i.test(m)) setExchangeConnected(false)
    }
    finally { setFetchingBalance(false) }
  }

  useEffect(() => { fetchBalance() /* preload on mount */ }, []) // eslint-disable-line

  function next() { setStep(s => (s < 5 ? ((s + 1) as any) : s)) }
  function back() { setStep(s => (s > 1 ? ((s - 1) as any) : s)) }

  async function activateBot() {
    if (activating) return
    if (capNum < 100) { setActivateMsg({ ok: false, text: 'Capital must be at least $100.' }); return }
    setActivating(true); setActivateMsg(null)
    try {
      await authedFetch('/api/bot-activate', {
        method: 'POST',
        body: JSON.stringify({
          preset,
          capital: capNum,
          leverage: ratios.leverage,
          notional: capNum * ratios.mult,
          compound,
          smart_sizing_enabled: false,
        }),
      })
      setActivateMsg({ ok: true, text: 'Bot activated! Returning to settings…' })
      setTimeout(onSaved, 1200)
    } catch (e: any) {
      const raw = String(e?.message || '')
      let msg = 'Failed to activate.'
      const j = raw.match(/\{.*\}/)
      if (j) { try { msg = JSON.parse(j[0])?.error || msg } catch {} }
      setActivateMsg({ ok: false, text: msg })
    } finally { setActivating(false) }
  }

  return (
    <div className="card card-pad settings-card">
      {/* Step pip row */}
      <div className="bw-pips">
        {[1, 2, 3, 4].map((n, i) => (
          <div key={n} className="bw-pip-wrap">
            <div className={'bw-pip ' + (n < step ? 'bw-done' : n === step ? 'bw-active' : 'bw-idle')}>
              {n < step ? '✓' : n}
            </div>
            {i < 4 && <div className={'bw-line ' + (n < step ? 'bw-done' : 'bw-idle')} />}
          </div>
        ))}
        <div className={'bw-pip ' + (step === 5 ? 'bw-active' : 'bw-idle')}>✓</div>
      </div>

      {/* Step 1 — Trading Mode */}
      {step === 1 && (
        <div className="bw-step-body">
          <div className="bw-step-title">Choose Your Trading Mode</div>
          <div className="bw-step-sub">This controls your risk exposure. The strategy logic (entries, exits, stop loss) stays the same — only position sizing changes.</div>
          <div className="bw-step-meta">
            All tiers trade the same 5-asset basket: <strong>BTC, ETH, SOL, XRP, SUI</strong> /USDT — same systematic strategy on every asset. Tier choice scales position size, not which assets trade.
          </div>

          <div className="bw-tier-grid">
            {(['conservative', 'bold', 'aggressive'] as const).map(p => {
              const r = TIER_RATIOS[p]
              const sel = preset === p
              return (
                <button
                  key={p}
                  type="button"
                  className={'bw-tier-card' + (sel ? ' bw-selected' : '')}
                  onClick={() => setPreset(p)}
                >
                  {r.recommended ? <span className="bw-recommend">RECOMMENDED</span> : null}
                  <div className="bw-tier-ico">
                    {p === 'conservative' ? <SVG><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></SVG>
                      : p === 'bold' ? <SVG><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></SVG>
                      : <SVG><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></SVG>}
                  </div>
                  <div className="bw-tier-name">{r.label}</div>
                  <div className="bw-tier-mult">{r.mult}× of balance</div>
                  <div className="bw-tier-blurb">{r.blurb}</div>
                </button>
              )
            })}
          </div>

          <button
            type="button"
            className="bw-toggle-projected"
            onClick={() => setShowProjected(s => !s)}
          >
            {showProjected ? '▲ Hide' : '▼ Show'} Projected Performance
          </button>
          {showProjected ? (
            <div className="bw-projected">
              <div className="bw-proj-head">
                <span>Projected Performance</span>
                <span className="bw-tip-wrap" tabIndex={0}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  <span className="bw-tip" role="tooltip">
                    Based on 8 years of backtested data. Past performance does not guarantee future results.
                  </span>
                </span>
              </div>
              {/* Row 1: Win Rate / Total Trades / Months Profitable — neutral */}
              <div className="bw-proj-row">
                <ProjStat label="Win Rate"          val={`${bt.winRatePct.toFixed(1)}%`} />
                <ProjStat label="Total Trades"      val={String(bt.totalTrades)} />
                <ProjStat label="Months Profitable" val="94/102" />
              </div>
              {/* Row 2: Total Return (green) / Max Drawdown (red) / Profit Factor (neutral) */}
              <div className="bw-proj-row">
                <ProjStat label="Total Return"   val={`+${bt.totalReturnPct.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}%`} positive />
                <ProjStat label="Max Drawdown"   val={`-${bt.maxDdPct.toFixed(1)}%`} negative />
                <ProjStat label="Profit Factor"  val={bt.profitFactor.toFixed(2)} />
              </div>
              {/* Row 3: Avg Win (green) / Avg Loss (red) / Annual Return (green) */}
              <div className="bw-proj-row">
                <ProjStat label="Avg Win"       val={`+${bt.avgWinPct.toFixed(1)}%`} positive />
                <ProjStat label="Avg Loss"      val={`-${bt.avgLossPct.toFixed(1)}%`} negative />
                <ProjStat label="Annual Return" val={`+${bt.annualPct.toFixed(0)}%`} positive />
              </div>

              {/* Equity Curve — projected for the selected tier */}
              <div className="bw-equity-card">
                <div className="bw-equity-head">Equity Curve</div>
                <div className="bw-equity-chart">
                  <ProjectedEquityCurve startCapital={1000} totalReturnPct={bt.totalReturnPct} />
                </div>
                <div className="bw-equity-foot">
                  Projected for <strong>{TIER_RATIOS[preset].label} tier ({TIER_RATIOS[preset].mult}× of balance)</strong>
                </div>
              </div>
            </div>
          ) : null}

          <div className="bw-actions" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="bw-btn-primary" onClick={next}>Next →</button>
          </div>
        </div>
      )}

      {/* Step 2 — Capital */}
      {step === 2 && (
        <div className="bw-step-body">
          <div className="bw-step-title">Set Your Capital</div>
          <div className="bw-step-sub">Enter your starting balance or fetch it directly from your exchange. This determines your position size and risk per trade.</div>

          {/* Inner card wrapping ALL step 2 content — matches v1 layout. */}
          <div className="bw-inner-card">
            <div className="bw-cap-row">
              <div style={{ flex: 1, minWidth: 180 }}>
                <label className="bw-label">Starting Capital ($)</label>
                <input
                  type="number"
                  value={capital}
                  min={100}
                  step={100}
                  onChange={e => setCapital(e.target.value)}
                  className="settings-input"
                  style={{ borderColor: overBalance ? 'var(--neg)' : undefined, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
                />
              </div>
              <button type="button" className="bw-btn-secondary" disabled={fetchingBalance} onClick={fetchBalance}>
                {fetchingBalance ? 'Fetching…' : 'Refresh Balance'}
              </button>
            </div>
            <div className="bw-cap-help">Your available exchange balance. Adjust if you want to trade with a portion of your funds.</div>
            {overBalance ? (
              <div className="neg-text" style={{ fontSize: 12, fontWeight: 600, marginTop: -4, marginBottom: 12 }}>
                Cannot exceed your exchange balance (${Math.floor(maxBalance).toLocaleString()})
              </div>
            ) : null}

            <div className="bw-position-card">
              <div className="bw-position-head">Position Parameters</div>
              <div className="bw-position-grid">
                <ProjStat label="Tier Multiplier"  val={`${ratios.mult}× of balance`} />
                <ProjStat label="Position Size"    val={`$${Math.round(posSize).toLocaleString()}`} />
                <ProjStat label="Stop Loss"        val={`${ratios.sl}%`} />
                <ProjStat label="Max Loss / Trade" val={`$${Math.round(maxLoss).toLocaleString()}`} negative />
              </div>
            </div>

            <div className="bw-explain">
              <strong>How it works:</strong> Your capital × tier multiplier = position size per trade. A {ratios.sl}% stop loss on a ${Math.round(posSize).toLocaleString()} position means you risk ${Math.round(maxLoss).toLocaleString()} per trade. Bitget leverage is set to {ratios.leverage}× by the bot — used only to free up margin, not to scale position size.
            </div>
          </div>

          <div className="bw-actions">
            <button type="button" className="bw-btn-back" onClick={back}>← Back</button>
            <button type="button" className="bw-btn-primary" onClick={next} disabled={overBalance || capNum < 100}>Next →</button>
          </div>
        </div>
      )}

      {/* Step 3 — Sizing + Compound */}
      {step === 3 && (
        <div className="bw-step-body">
          <div className="bw-step-title">How Position Sizing Works</div>
          <div className="bw-step-sub">Position size is set when you activate the bot — based on your balance at that moment. From there, you choose: keep it <strong>fixed</strong> (default; risk shrinks as you win) or let it <strong>compound</strong> with your balance (constant risk %, faster compounding).</div>

          <div className="bw-compound-card">
            <div className="bw-compound-head">
              <div>
                <div className="bw-compound-ttl">Compound mode</div>
                <div className="bw-compound-help">When ON, every trade is sized as <em>current balance × your tier ratio</em>. Wins and losses both affect the next trade's size. <strong>Default OFF</strong>: trade size stays fixed at your activation balance.</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={compound}
                className={'toggle-switch' + (compound ? ' on' : '')}
                onClick={() => setCompound(c => !c)}
              >
                <span className="toggle-knob" />
              </button>
            </div>
            <div className="bw-compound-conseq">
              {compound
                ? <><strong>On:</strong> on a ${capNum.toLocaleString()} starting balance, every trade scales with your current equity. As your account grows, position sizes grow too — drawdowns also hit larger positions.</>
                : <><strong>Off (recommended):</strong> on a ${capNum.toLocaleString()} starting balance, every trade is sized from ${capNum.toLocaleString()} forever. As your account grows, % drawdowns shrink — you de-leverage as you win.</>
              }
            </div>
          </div>

          {/* Pyramid stacking eyebrow + intro (matches v1) */}
          <div className="bw-pyramid-eyebrow">Pyramid stacking</div>
          <p className="bw-pyramid-intro">
            Your chosen tier is the <em>floor</em> of your sizing. The strategy can stack on top via <strong>pyramids</strong> — additional legs added on a small subset of qualifying winners. Worst case below shows what peak exposure looks like.
          </p>

          {/* Worked example block — same numbers v1 hard-codes for $10k Conservative */}
          <div className="bw-worked-card">
            <div className="bw-worked-head">
              Worked example · {TIER_RATIOS[preset].label} tier on ${(capNum || 10000).toLocaleString()} balance
            </div>
            <div className="bw-worked-intro">
              {TIER_RATIOS[preset].label} = {ratios.mult}× of your balance per position. Same systematic strategy across all 5 basket assets, longs &amp; shorts, with pyramiding on a subset of qualifying winners.
            </div>
            <div className="bw-worked-row">
              <span>Base entry — any of 5 assets</span>
              <span className="num">${Math.round((capNum || 10000) * ratios.mult).toLocaleString()} ({ratios.mult}×)</span>
            </div>
            <div className="bw-worked-row">
              <span>Stop loss — {ratios.sl}% from entry</span>
              <span className="num neg-text">-${Math.round((capNum || 10000) * ratios.mult * (ratios.sl / 100)).toLocaleString()} max / leg</span>
            </div>
            <div className="bw-worked-row">
              <span>After profits — balance ${Math.round((capNum || 10000) * 1.4).toLocaleString()} (Off mode)</span>
              <span className="num pos-text">unchanged (${Math.round((capNum || 10000) * ratios.mult).toLocaleString()})</span>
            </div>
            <div className="bw-worked-row">
              <span>After profits — balance ${Math.round((capNum || 10000) * 1.4).toLocaleString()} (Compound ON)</span>
              <span className="num pos-text">${Math.round((capNum || 10000) * 1.4 * ratios.mult).toLocaleString()} ({ratios.mult}×)</span>
            </div>
          </div>

          {/* Pyramid exposure card — gold-tinted with peak exposure breakdown */}
          <div className="bw-pyramid-card">
            <div className="bw-pyramid-head">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg>
              Peak exposure (with pyramid)
            </div>
            <p className="bw-pyramid-blurb">
              When a winning trade meets the strategy&apos;s re-entry criteria, the bot adds a single pyramid leg sized at 50% of the base. Peak exposure on <em>{TIER_RATIOS[preset].label}</em> on a ${(capNum || 10000).toLocaleString()} account therefore tops out at <strong>${Math.round((capNum || 10000) * ratios.mult * 1.5).toLocaleString()} per position</strong> ({(ratios.mult * 1.5).toFixed(2)}× of balance).
            </p>
            <div className="bw-pyramid-row">
              <span>Base entry (no pyramid)</span>
              <span className="num">${Math.round((capNum || 10000) * ratios.mult).toLocaleString()} · {ratios.mult}×</span>
            </div>
            <div className="bw-pyramid-row">
              <span>+ Pyramid leg (qualifying winner)</span>
              <span className="num">${Math.round((capNum || 10000) * ratios.mult * 1.5).toLocaleString()} · {(ratios.mult * 1.5).toFixed(2)}×</span>
            </div>
            <p className="bw-pyramid-foot">
              Roughly 1 in 5 winners pyramid. Pyramid losses can exceed the {ratios.sl}% base stop loss because the pyramid enters at a higher price.
            </p>
          </div>

          {/* "You stay in control" callout (gold) */}
          <div className="bw-control-card">
            <strong>You stay in control.</strong> You can switch tiers (Conservative / Bold / Aggressive) at any time, and withdrawing from your exchange reduces exposure proportionally. Your next trade always sizes from your balance and tier <em>at that moment</em> — nothing is locked in.
          </div>

          {/* Compound drawdown warning — only when compound mode is ON */}
          {compound ? (
            <div className="bw-compound-warn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span>Compound mode is ON: position scales with your balance, so drawdowns hit larger positions harder. A higher tier means bigger swings in both directions. Pick a tier you can live with through a losing streak <em>at peak exposure</em>.</span>
            </div>
          ) : null}

          <div className="bw-actions">
            <button type="button" className="bw-btn-back" onClick={back}>← Back</button>
            <button type="button" className="bw-btn-primary" onClick={next}>Next →</button>
          </div>
        </div>
      )}

      {/* Step 4 — Projection */}
      {step === 4 && (
        <div className="bw-step-body">
          <div className="bw-step-title">12-Month Projection</div>
          <div className="bw-step-sub">Based on the 5-asset Satoshi Stacker portfolio backtest (BTC + ETH + SOL + XRP + SUI, 6.8 yr Bitget data). Past performance ≠ future results.</div>

          <div className="bw-proj-row">
            <ProjStat
              label="Projected Return"
              val={`+$${Math.round(capNum * (bt.annualPct / 100)).toLocaleString()}`}
              sub={`+${bt.annualPct.toFixed(0)}%`}
              positive
              big
            />
            <ProjStat
              label="Est. Ending Balance"
              val={`$${Math.round(capNum * (1 + bt.annualPct / 100)).toLocaleString()}`}
              sub={`from $${capNum.toLocaleString()}`}
              big
            />
          </div>

          {/* Bottom row — Liquidation Risk in the middle (matches v1 #simLiqRisk).
              Risk is per-tier: Conservative=Very Low, Bold=Low, Aggressive=Medium. */}
          <div className="bw-proj-row">
            <ProjStat label="Max Drawdown" val={`-${bt.maxDdPct.toFixed(1)}%`} sub={`-$${Math.round(capNum * bt.maxDdPct / 100).toLocaleString()}`} negative />
            <ProjStat
              label="Liquidation Risk"
              val={preset === 'conservative' ? 'Very Low' : preset === 'bold' ? 'Low' : 'Medium'}
              sub={preset === 'conservative' ? 'No liquidation risk' : preset === 'bold' ? '~50% adverse to liquidate' : '~33% adverse to liquidate'}
              positive={preset !== 'aggressive'}
            />
            <ProjStat label="Risk per Trade" val={`$${Math.round(maxLoss).toLocaleString()}`} sub={`${(maxLoss / capNum * 100).toFixed(1)}% of capital`} />
          </div>

          <div className="bw-risk-band">
            <div className="bw-risk-track" />
            <div className="bw-risk-dot" style={{ left: `${bt.riskPos}%` }} />
            <div className="bw-risk-ends">
              <span>Conservative</span>
              <span>Bold</span>
              <span>Aggressive</span>
            </div>
          </div>

          <div className="bw-disclaimer">These projections are based on historical backtests. Actual results may vary. Never invest more than you can afford to lose.</div>

          <div className="bw-actions">
            <button type="button" className="bw-btn-back" onClick={back}>← Back</button>
            <button type="button" className="bw-btn-primary" onClick={next}>Next →</button>
          </div>
        </div>
      )}

      {/* Step 5 — Review & Activate */}
      {step === 5 && (
        <div className="bw-step-body">
          <div className="bw-step-title">Review & Activate</div>
          <div className="bw-step-sub">Double-check your settings below. You can change them anytime from Bot Settings.</div>

          {!exchangeConnected ? (
            <div className="bw-no-exchange">
              <div className="bw-no-exchange-head">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span>Exchange not connected</span>
              </div>
              <div className="bw-no-exchange-body">
                Connect your exchange API keys first to ensure capital matches your real balance. Go to <Link href="/settings?tab=api" prefetch>API Keys</Link> or complete the <Link href="/onboarding" prefetch>onboarding wizard</Link>.
              </div>
            </div>
          ) : null}

          <div className="bw-review-card">
            <div className="bw-review-row"><span>Trading Mode</span><span>{TIER_RATIOS[preset].label}</span></div>
            <div className="bw-review-row"><span>Starting Capital</span><span className="num">${capNum.toLocaleString()}</span></div>
            <div className="bw-review-row"><span>Position Size (per trade)</span><span className="num">${Math.round(posSize).toLocaleString()}</span></div>
            <div className="bw-review-row"><span>Bitget Leverage</span><span className="num">{ratios.leverage}×</span></div>
            <div className="bw-review-row"><span>Max Loss / Trade</span><span className="num neg-text">-${Math.round(maxLoss).toLocaleString()}</span></div>
            <div className="bw-review-row"><span>Compound mode</span><span>{compound ? 'On (proportional)' : 'Off (fixed)'}</span></div>
            <div className="bw-review-row"><span>Projected Annual Return</span><span className="num pos-text">+${Math.round(capNum * (bt.annualPct / 100)).toLocaleString()}</span></div>
          </div>

          {activateMsg ? (
            <div className={activateMsg.ok ? 'pos-text' : 'neg-text'} style={{ fontSize: 13, fontWeight: 600, padding: '10px 12px', background: activateMsg.ok ? 'rgba(46,204,113,0.06)' : 'rgba(255,77,79,0.06)', border: '1px solid ' + (activateMsg.ok ? 'rgba(46,204,113,0.22)' : 'rgba(255,77,79,0.22)'), borderRadius: 8 }}>
              {activateMsg.text}
            </div>
          ) : null}

          <button type="button" className="bw-btn-activate" onClick={activateBot} disabled={activating}>
            {activating ? 'Activating…' : 'Activate Bot →'}
          </button>

          {/* Single full-width Back button — matches v1's "← Back to Review Projection" */}
          <button type="button" className="bw-btn-back-wide" onClick={back}>← Back to Review Projection</button>
        </div>
      )}
    </div>
  )
}

const SVG = ({ children }: { children: React.ReactNode }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
)

function ProjStat({
  label, val, sub, positive, negative, big,
}: { label: string; val: string; sub?: string; positive?: boolean; negative?: boolean; big?: boolean }) {
  const cls = positive ? 'pos-text' : negative ? 'neg-text' : ''
  return (
    <div className="bw-proj-stat">
      <div className="bw-proj-stat-label">{label}</div>
      <div className={'bw-proj-stat-val num ' + cls + (big ? ' big' : '')}>{val}</div>
      {sub ? <div className="bw-proj-stat-sub">{sub}</div> : null}
    </div>
  )
}

function BotRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bot-row">
      <span className="bot-row-label">{label}</span>
      <span className="bot-row-value">{value}</span>
    </div>
  )
}

// ─── Notifications ──────────────────────────────────────────────────────────
// Three blocks (mirrors v1 client-dashboard.html § settings-notifications):
//   1. Telegram — connect / linked status / disconnect (POST/GET/DELETE /api/telegram/link)
//   2. Notification preferences — 4 events × 2 channels (PUT /api/telegram/prefs)
//   3. Notification Log — recent items from /api/trades?limit=500, manual refresh

const PREF_EVENTS = [
  { key: 'trade_alerts',   labelEn: 'Trade Alerts',     labelPt: 'Alertas de Trade',     helpEn: 'Get notified when a trade opens or closes',                helpPt: 'Receba quando um trade abre ou fecha' },
  { key: 'weekly_reports', labelEn: 'Weekly Reports',   labelPt: 'Relatórios Semanais',  helpEn: 'Performance summary every Monday',                          helpPt: 'Resumo de desempenho toda segunda' },
  { key: 'system_alerts',  labelEn: 'System Alerts',    labelPt: 'Alertas do Sistema',   helpEn: 'Bot status changes, downtime alerts',                       helpPt: 'Mudanças de status do bot, alertas de inatividade' },
  { key: 'billing',        labelEn: 'Billing & Payouts',labelPt: 'Cobrança & Pagamentos',helpEn: 'Invoice reminders, payment confirmations, commission payouts', helpPt: 'Lembretes de fatura, confirmações de pagamento, comissões' },
] as const

type PrefKey = (typeof PREF_EVENTS)[number]['key']
type PrefMap = Record<string, boolean>

type TelegramLinkStatus = {
  linked: boolean
  username: string | null
  linkedAt: string | null
  prefs: PrefMap
}

type NotifLogItem = {
  id: string
  type: string
  icon: string
  timestamp: string
  message: string
  isWin?: boolean
}

function NotificationsPanel() {
  const t = useT()
  const isPt = t('common.lang') === 'PT' || (typeof navigator !== 'undefined' && navigator.language?.startsWith('pt'))
  const tt = (en: string, pt: string) => (isPt ? pt : en)

  // ── Telegram link state
  const [tgLinked, setTgLinked] = useState(false)
  const [tgUsername, setTgUsername] = useState<string | null>(null)
  const [tgLinkedAt, setTgLinkedAt] = useState<string | null>(null)
  const [tgDeepLink, setTgDeepLink] = useState<string | null>(null)
  const [tgConnecting, setTgConnecting] = useState(false)
  const tgPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Prefs
  const [prefs, setPrefs] = useState<PrefMap>({
    trade_alerts: true, weekly_reports: true, system_alerts: true, billing: true,
    tg_trade_alerts: true, tg_weekly_reports: true, tg_system_alerts: true, tg_billing: true,
  })

  // ── Notification log
  const [logItems, setLogItems] = useState<NotifLogItem[]>([])
  const [logState, setLogState] = useState<'loading' | 'ready' | 'error' | 'empty'>('loading')
  const [logErrorCode, setLogErrorCode] = useState<string>('')
  const [logRefreshing, setLogRefreshing] = useState(false)

  // ─── Telegram status loader (also seeds prefs on first load) ──────────
  const loadTelegramStatus = useCallback(async () => {
    try {
      const j = await authedFetch<TelegramLinkStatus>('/api/telegram/link')
      setTgLinked(!!j.linked)
      setTgUsername(j.username)
      setTgLinkedAt(j.linkedAt)
      if (j.prefs && typeof j.prefs === 'object') {
        // Server canonicalises only base keys — preserve our tg_ defaults.
        setPrefs(p => ({ ...p, ...j.prefs }))
      }
    } catch { /* silent — keep current state */ }
  }, [])

  useEffect(() => {
    loadTelegramStatus()
    return () => { if (tgPollRef.current) clearInterval(tgPollRef.current) }
  }, [loadTelegramStatus])

  // ─── Notification log loader ──────────────────────────────────────────
  const loadLog = useCallback(async (manual: boolean = false) => {
    if (manual) setLogRefreshing(true)
    else setLogState('loading')
    try {
      const j = await authedFetch<{ notifications: NotifLogItem[] }>('/api/trades?limit=500')
      const items = (j?.notifications || []).filter(n => {
        if (!n.timestamp) return false
        // Same 24h auto-dismiss window as v1 (loadNotifications).
        return new Date(n.timestamp).getTime() > Date.now() - 24 * 3600 * 1000
      })
      setLogItems(items)
      setLogState(items.length ? 'ready' : 'empty')
    } catch (e: any) {
      const m = String(e?.message || '')
      const code = m.match(/^(\d{3})/)?.[1] || 'network'
      setLogErrorCode(`HTTP ${code}`)
      setLogState('error')
    } finally {
      setLogRefreshing(false)
    }
  }, [])

  useEffect(() => { loadLog(false) }, [loadLog])

  // ─── Telegram connect / disconnect ────────────────────────────────────
  async function handleConnectTelegram() {
    setTgConnecting(true)
    try {
      const j = await authedFetch<{ deepLink: string; expiresAt: string }>('/api/telegram/link', { method: 'POST' })
      setTgDeepLink(j.deepLink)
      // Poll every 3s for up to 3 minutes for the user to complete the link.
      let polls = 0
      if (tgPollRef.current) clearInterval(tgPollRef.current)
      tgPollRef.current = setInterval(async () => {
        polls++
        if (polls > 60) { if (tgPollRef.current) clearInterval(tgPollRef.current); return }
        try {
          const s = await authedFetch<TelegramLinkStatus>('/api/telegram/link')
          if (s.linked) {
            if (tgPollRef.current) clearInterval(tgPollRef.current)
            setTgLinked(true)
            setTgUsername(s.username)
            setTgLinkedAt(s.linkedAt)
            setTgDeepLink(null)
            setTgConnecting(false)
          }
        } catch { /* keep polling */ }
      }, 3000)
    } catch {
      setTgConnecting(false)
    }
  }

  async function handleDisconnectTelegram() {
    if (!confirm(tt('Disconnect Telegram? You will no longer receive notifications there.', 'Desconectar o Telegram? Você deixará de receber notificações por lá.'))) return
    try {
      await authedFetch('/api/telegram/link', { method: 'DELETE' })
      setTgLinked(false)
      setTgUsername(null)
      setTgLinkedAt(null)
      setTgDeepLink(null)
      // Clear telegram-side toggles UI-only — server defaults will repopulate on next load.
      setPrefs(p => ({ ...p, tg_trade_alerts: false, tg_weekly_reports: false, tg_system_alerts: false, tg_billing: false }))
    } catch { /* show in UI later if needed */ }
  }

  // ─── Save prefs ───────────────────────────────────────────────────────
  // Debounced — clicking many checkboxes shouldn't fire a request per click.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function savePrefs(next: PrefMap) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      authedFetch('/api/telegram/prefs', { method: 'PUT', body: JSON.stringify(next) }).catch(() => {})
    }, 350)
  }

  function togglePref(key: string, on: boolean) {
    setPrefs(prev => {
      const next = { ...prev, [key]: on }
      savePrefs(next)
      return next
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Telegram block ──────────────────────────────────────────── */}
      <div className="card card-pad">
        <div className="bt-card-head">
          <div className="bt-card-title"><span className="bt-card-bar" />{tt('TELEGRAM', 'TELEGRAM')}</div>
        </div>
        <div className="tg-block">
          {!tgLinked ? (
            <>
              <div className="tg-blurb">
                {tt(
                  'Connect your Telegram to receive instant trade alerts, payment notifications, and weekly reports directly in your chat.',
                  'Conecte seu Telegram para receber alertas instantâneos de trade, notificações de pagamento e relatórios semanais direto no seu chat.'
                )}
              </div>
              <button
                type="button"
                className="tg-connect-btn"
                disabled={tgConnecting}
                onClick={handleConnectTelegram}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                {tgConnecting ? tt('Generating link…', 'Gerando link…') : tt('Connect Telegram', 'Conectar Telegram')}
              </button>
              {tgDeepLink ? (
                <div className="tg-deeplink-card">
                  <div className="lbl">{tt('Click the link below to open Telegram and connect:', 'Clique no link abaixo para abrir o Telegram e conectar:')}</div>
                  <a href={tgDeepLink} target="_blank" rel="noreferrer noopener">{tgDeepLink}</a>
                  <div className="expiry">{tt('Link expires in 15 minutes.', 'O link expira em 15 minutos.')}</div>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="tg-linked-card">
                <span className="ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
                <div>
                  <div className="ttl">{tt('Telegram Connected', 'Telegram Conectado')}</div>
                  <div className="sub">{tgUsername ? `@${tgUsername}` : tgLinkedAt ? `${tt('Connected', 'Conectado')} ${new Date(tgLinkedAt).toLocaleDateString()}` : ''}</div>
                </div>
              </div>
              <button type="button" className="tg-disconnect-btn" onClick={handleDisconnectTelegram}>
                {tt('Disconnect Telegram', 'Desconectar Telegram')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Notification preferences ───────────────────────────────── */}
      <div className="card card-pad">
        <div className="bt-card-head">
          <div className="bt-card-title"><span className="bt-card-bar" />{tt('NOTIFICATIONS', 'NOTIFICAÇÕES')}</div>
        </div>
        <div className="notif-prefs-grid">
          <div className="head first" />
          <div className="head">{tt('Email', 'E-mail')}</div>
          <div className="head">{tt('Telegram', 'Telegram')}</div>

          {PREF_EVENTS.map(ev => (
            <div key={ev.key} style={{ display: 'contents' }}>
              <div className="row-name">
                <div className="pref-label">{isPt ? ev.labelPt : ev.labelEn}</div>
                <div className="pref-help">{isPt ? ev.helpPt : ev.helpEn}</div>
              </div>
              <div className="row-cb">
                <input
                  type="checkbox"
                  className="notif-cb"
                  checked={!!prefs[ev.key]}
                  onChange={e => togglePref(ev.key, e.target.checked)}
                />
              </div>
              <div className="row-cb">
                <input
                  type="checkbox"
                  className="notif-cb tg"
                  checked={!!prefs[`tg_${ev.key}`]}
                  disabled={!tgLinked}
                  onChange={e => togglePref(`tg_${ev.key}`, e.target.checked)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Notification Log ───────────────────────────────────────── */}
      <div className="card card-pad">
        <div className="notif-log-head">
          <div>
            <div className="bt-card-title"><span className="bt-card-bar" />{tt('NOTIFICATION LOG', 'HISTÓRICO DE NOTIFICAÇÕES')}</div>
            <div className="notif-log-head-meta">
              {tt('Recent in-app history for trades, billing, and broker payouts.', 'Histórico recente de trades, cobrança e comissões.')}
            </div>
          </div>
          <button
            type="button"
            className="notif-log-refresh"
            disabled={logRefreshing}
            onClick={() => loadLog(true)}
          >
            {logRefreshing ? tt('Refreshing…', 'Atualizando…') : `↻ ${tt('Refresh', 'Atualizar')}`}
          </button>
        </div>

        <div className="notif-log-list">
          {logState === 'loading' ? (
            <div className="notif-log-empty">{tt('Loading notifications…', 'Carregando notificações…')}</div>
          ) : logState === 'empty' ? (
            <div className="notif-log-empty">{tt('No notification history yet.', 'Ainda não há histórico de notificações.')}</div>
          ) : logState === 'error' ? (
            <div className="notif-log-error">
              {tt('Unable to load notification history.', 'Não foi possível carregar o histórico.')} ({logErrorCode}) — <a onClick={() => loadLog(true)}>{tt('retry', 'tentar novamente')}</a>
            </div>
          ) : (
            logItems.map(n => (
              <div key={n.id} className="notif-log-row">
                <span className="ico">{n.icon || '⚡️'}</span>
                <div className="body">
                  <div className="row-top">
                    <div className="msg">{n.message}</div>
                    <div className="ts">{n.timestamp ? new Date(n.timestamp).toLocaleString() : ''}</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Security ───────────────────────────────────────────────────────────────

function SecurityPanel() {
  const t = useT()
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [conf, setConf] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function update() {
    if (busy) return
    if (!next || next !== conf) {
      setMsg({ kind: 'err', text: 'Passwords do not match.' })
      return
    }
    setBusy(true); setMsg(null)
    try {
      const r = await authedFetch('/api/update-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: cur, newPassword: next }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.error || 'Update failed')
      }
      setMsg({ kind: 'ok', text: 'Password updated.' })
      setCur(''); setNext(''); setConf('')
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || t('common.error') })
    } finally {
      setBusy(false)
    }
  }

  async function signOutAll() {
    try {
      const sb = browserClient()
      await sb.auth.signOut({ scope: 'global' })
      window.location.href = '/login'
    } catch {}
  }

  return (
    <div className="card card-pad settings-card">
      <h3 className="settings-card-title">{t('security.title')}</h3>
      <div className="settings-form">
        <Field label={t('security.currentPwd')}>
          <input type="password" value={cur} onChange={e => setCur(e.target.value)} className="settings-input" />
        </Field>
        <Field label={t('security.newPwd')}>
          <input type="password" value={next} onChange={e => setNext(e.target.value)} className="settings-input" />
        </Field>
        <Field label={t('security.confirmPwd')}>
          <input type="password" value={conf} onChange={e => setConf(e.target.value)} className="settings-input" />
        </Field>
        {msg ? <div className={msg.kind === 'ok' ? 'pos-text' : 'neg-text'} style={{ fontSize: 12 }}>{msg.text}</div> : null}
        <button onClick={update} disabled={busy || !cur || !next} className="settings-btn-primary">
          {busy ? t('common.loading') : t('security.update')}
        </button>
        <div style={{ borderTop: '1px solid var(--line)', marginTop: 24, paddingTop: 16 }}>
          <h4 className="settings-card-title" style={{ fontSize: 14, marginBottom: 8 }}>{t('security.sessions')}</h4>
          <button onClick={signOutAll} className="settings-btn-secondary">
            {t('security.signOutAll')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Payout ─────────────────────────────────────────────────────────────────

function PayoutPanel() {
  const t = useT()
  const [method, setMethod] = useState<'btc' | 'usdt' | 'bank'>('btc')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedAt, setSavedAt] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await authedFetch('/api/payout-settings')
        if (r.ok) {
          const j = await r.json()
          if (cancelled) return
          if (j?.method) setMethod(j.method)
          if (j?.address) setAddress(j.address)
        }
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      await authedFetch('/api/payout-settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, address }),
      })
      setSavedAt(Date.now())
    } catch {} finally { setBusy(false) }
  }

  const justSaved = savedAt && Date.now() - savedAt < 2000

  return (
    <div className="card card-pad settings-card">
      <h3 className="settings-card-title">{t('payout.title')}</h3>
      <div className="settings-form">
        <Field label={t('payout.method')}>
          <div className="payout-method-row">
            {([['btc', t('payout.bitcoin')], ['usdt', t('payout.usdt')], ['bank', t('payout.bank')]] as const).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                className={'payout-method-card' + (method === k ? ' active' : '')}
                onClick={() => setMethod(k)}
              >
                {lbl}
              </button>
            ))}
          </div>
        </Field>
        {method !== 'bank' ? (
          <Field label={t('payout.address')}>
            <input
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder={method === 'btc' ? 'bc1q...' : 'TR...'}
              className="settings-input"
            />
          </Field>
        ) : (
          <div className="settings-help">Contact support@staxs.ai to set up bank wire details.</div>
        )}
        <Field label={t('payout.minPayout')}>
          <div className="settings-help">$20 minimum claim · paid out monthly</div>
        </Field>
        <button onClick={save} disabled={busy} className="settings-btn-primary">
          {justSaved ? t('profile.saved') : t('payout.save')}
        </button>
      </div>
    </div>
  )
}

// ─── shared ─────────────────────────────────────────────────────────────────

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="settings-field">
      <label className="settings-field-label">{label}</label>
      {children}
      {help ? <div className="settings-field-help">{help}</div> : null}
    </div>
  )
}
