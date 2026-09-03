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

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { InvoicePayPanel } from './InvoicePayPanel'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Icons } from './Icons'
import { NotifIcon } from './NotifIcon'
import { useT } from '@/lib/i18n'
import { browserClient } from '@/lib/supabase-browser'
import { authedFetch } from '@/lib/api'
import { PHASE_H_BASKET } from '@/lib/phase-h-basket'
import { patchWizardState, useWizardState } from '@/lib/use-wizard-state'
import { OnboardingTourController, TOUR1_STEPS, TOUR2_STEPS } from './OnboardingTour'
import { buildCeilingGrid } from '../../../lib/leverage-ceiling'

type TabId = 'profile' | 'billing' | 'bot' | 'notifications' | 'security' | 'tour' | 'payout'

const TABS: Array<{ id: TabId; tKey: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'profile',       tKey: 'settings.profile',       icon: Icons.Robot   /* placeholder; user icon */ },
  { id: 'billing',       tKey: 'settings.billing',       icon: Icons.Briefcase },
  { id: 'bot',           tKey: 'settings.bot',           icon: Icons.Robot },
  { id: 'notifications', tKey: 'settings.notifications', icon: Icons.Bell },
  { id: 'security',      tKey: 'settings.security',      icon: Icons.Shield },
  { id: 'tour',          tKey: 'settings.tour',          icon: Icons.Play },
  { id: 'payout',        tKey: 'settings.payout',        icon: Icons.Briefcase },
]

export function SettingsContent() {
  const t = useT()
  const search = useSearchParams()
  const router = useRouter()

  const tabFromUrl = (search?.get('tab') || 'profile') as TabId
  const initialTab: TabId = TABS.find(t => t.id === tabFromUrl) ? tabFromUrl : 'profile'
  const [tab, setTab] = useState<TabId>(initialTab)
  // 2026-05-26 lazy-mount tracking: tabs the user has activated at least
  // once stay mounted thereafter (so subsequent tab switches are instant).
  // Initial set = {initialTab} so the user only fetches data for the panel
  // they actually land on, not all 7.
  const [mountedTabs, setMountedTabs] = useState<Set<TabId>>(() => new Set([initialTab]))

  useEffect(() => {
    const next = (search?.get('tab') || 'profile') as TabId
    if (TABS.find(x => x.id === next) && next !== tab) {
      setTab(next)
      setMountedTabs(prev => prev.has(next) ? prev : new Set([...prev, next]))
    }
  }, [search])

  function selectTab(id: TabId) {
    setTab(id)
    setMountedTabs(prev => prev.has(id) ? prev : new Set([...prev, id]))
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
        {/* 2026-05-26 Phase 1 #5 perf fix: lazy-mount + persistent-mount hybrid.
            Original "all mounted" design fired ~10 parallel API calls on first
            page load (each panel's own useEffect). Lazy-mount: panels mount on
            FIRST activation, then stay mounted for instant subsequent switches
            (no second useEffect refetch). Result: cold first-mount loads only
            the active panel's data; subsequent tab switches stay instant
            (same as before). */}
        <div className="settings-panel">
          {mountedTabs.has('profile')       && <div style={{ display: tab === 'profile'       ? 'block' : 'none' }}><ProfilePanel /></div>}
          {mountedTabs.has('billing')       && <div style={{ display: tab === 'billing'       ? 'block' : 'none' }}><BillingPanel /></div>}
          {mountedTabs.has('bot')           && <div style={{ display: tab === 'bot'           ? 'block' : 'none' }}><BotPanel /></div>}
          {mountedTabs.has('notifications') && <div style={{ display: tab === 'notifications' ? 'block' : 'none' }}><NotificationsPanel /></div>}
          {mountedTabs.has('security')      && <div style={{ display: tab === 'security'      ? 'block' : 'none' }}><SecurityPanel /></div>}
          {mountedTabs.has('tour')          && <div style={{ display: tab === 'tour'          ? 'block' : 'none' }}><TourPanel active={tab === 'tour'} /></div>}
          {mountedTabs.has('payout')        && <div style={{ display: tab === 'payout'        ? 'block' : 'none' }}><PayoutPanel /></div>}
        </div>
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
      {/* 2026-09-03 (Chris): if something is due it goes FIRST — above the plan and the period. */}
      <InvoicePayPanel onChange={() => window.location.reload()} />

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
        <div className="bp-history-wrap" style={{ overflowX: 'auto' }}>
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

        {/* Phone view of the same history. The six-column table cut Net and Status off the
            right edge at 390px with no scroll affordance, so the rows read as missing data.
            Live Trading's .lt-cards does exactly this under the same 768px breakpoint. */}
        <div className="bp-history-cards">
          {data.history.length === 0 ? (
            <div className="bp-hcard-empty">No billing history yet</div>
          ) : data.history.map(h => {
            const net = h.grossPnlCents - h.feeAmountCents
            const labels: Record<string, string> = { open: 'Active', locked: 'Locked', invoiced: 'Invoiced', paid: 'Paid', failed: 'Failed' }
            return (
              <div className="bp-hcard" key={h.id}>
                <div className="bp-hcard-head">
                  <div>
                    <div className="bp-hcard-period">{fmtMonthYear(h.startTs)}</div>
                    <div className="bp-hcard-plan">{h.planName || '—'}</div>
                  </div>
                  <div style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                    <span className={'bp-status-dot bp-status-dot-' + h.status} />{labels[h.status] || h.status}
                  </div>
                </div>
                <div className="bp-hcard-grid">
                  <div className="bp-hcard-row">
                    <div className="bp-hcard-label">PnL</div>
                    <div className={'bp-hcard-val ' + (h.grossPnlCents >= 0 ? 'pos-text' : 'neg-text')}>{fmtCents(h.grossPnlCents)}</div>
                  </div>
                  <div className="bp-hcard-row">
                    <div className="bp-hcard-label">Fee</div>
                    <div className="bp-hcard-val" style={{ color: h.feeAmountCents > 0 ? 'var(--gold)' : 'var(--muted)' }}>
                      {h.feeAmountCents > 0 ? fmtCentsAbs(h.feeAmountCents) : '$0'}
                    </div>
                  </div>
                  <div className="bp-hcard-row">
                    <div className="bp-hcard-label">Net</div>
                    <div className={'bp-hcard-val ' + (net >= 0 ? 'pos-text' : 'neg-text')}>{fmtCents(net)}</div>
                  </div>
                </div>
              </div>
            )
          })}
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

type LegacyTierId = 'conservative' | 'moderate' | 'aggressive' | 'bold'

type BotConfig = {
  preset?: LegacyTierId
  tier?: LegacyTierId
  leverage?: number
  capital?: number
  activation_balance?: number
  hb_base_notional_usd?: number
  notional?: number
  compound?: boolean
  smart_sizing_enabled?: boolean
  updatedAt?: string
}

const TIER_LEVERAGE: Record<'conservative' | 'moderate' | 'aggressive' | 'kamikaze', number> = {
  conservative: 1,
  moderate: 3,
  aggressive: 6,
  kamikaze: 9,
}

// Tier ratios — Phase H Tier-grid v2 (2026-06-09).
// Tier = (lanes, leverage, base_pct). Per-lane notional = capital × base_pct.
// Tier choice controls how many concurrent lanes (FCFS allocator caps at this
// number), the leverage each lane runs at, and the per-lane sizing fraction.
// SL is 4% of entry across basket.
//
// Tier-grid v2 invariants (locked 2026-06-09):
//   conservative: 2 ordinary (+1 reserved) × 1× lev × 50%  = 1× capital max ordinary notional
//   moderate:     4 ordinary (+1 reserved) × 3× lev × 75%  = 3× capital max ordinary notional
//   aggressive:   6 ordinary (+1 reserved) × 6× lev × 100% = 6× capital max ordinary notional
//   2026-09-02: the reserved seat is Tier-S-only and ADDS to the ceiling — a fully occupied tier
//   can hold one more position than its ordinary count, so worst-case exposure is (ordinary+1)
//   lanes' notional, not (ordinary). Per-trade size is unchanged: it never divides by lanes.
//
// Nominal leverage = lanes × base_pct (Cons 1×, Mod 3×, Aggr 6×) — 6× is the
// 6L-stress-validated ceiling (4.30× real peak, 0 liq). Per-lane notional =
// capital × base_pct, so users can dial in a portion of their balance and every
// downstream metric scales proportionally.
//
// Max single-trade loss per lane = (capital × base_pct) × 4% SL. On Aggressive
// with all 6 ORDINARY lanes occupied, max simultaneous SL = capital × 6 × 4% ≈ 24%; with the
// reserved Tier-S seat also filled it is capital × 7 × 4% ≈ 28%.
const COMPOUND_CAP_MULTIPLIER = 2 as const  // compound lanes cap at 2× capital_initial

// Staxs mode reserve target as % of capital_initial, per tier. The reserve
// is built up monthly from profits and acts as a buffer before BTC DCA kicks
// in. Higher-tier users carry more leverage risk → larger reserve cushion.
const RESERVE_PCT_BY_TIER: Record<TierKey, number> = {
  conservative: 0.15,
  moderate:     0.20,
  aggressive:   0.30,
  kamikaze:     0.30,
}

const TIER_RATIOS = {
  // 2026-09-02 SUPER LANE — every tier is ORDINARY LANES + ONE RESERVED SEAT that only a
  // protected (Tier-S) strategy may take. Ordinary capacity is unchanged from before; the extra
  // seat is additional. These counts must match the live engine (tier_sizing._TIER_SHAPE) and
  // canonical, because this table is what the wizard writes into the bot's config as
  // lanes_active — a stale number here means the bot is configured for a book it is not running.
  conservative: { lanes: 3, ordinary: 2, leverage: 1, basePct: 0.50, sl: 4, label: 'Conservative', blurb: 'Smoother ride. Lowest risk exposure.',           recommended: false },
  moderate:     { lanes: 5, ordinary: 4, leverage: 3, basePct: 0.75, sl: 4, label: 'Moderate',     blurb: 'Balanced default. Best risk/reward.',            recommended: true  },
  aggressive:   { lanes: 7, ordinary: 6, leverage: 6, basePct: 1.00, sl: 4, label: 'Aggressive',   blurb: 'Full capture. Highest risk.',                    recommended: false },
  kamikaze:     { lanes: 8, ordinary: 7, leverage: 9, basePct: 1.25, sl: 4, label: 'Kamikaze',     blurb: 'Disclosed tail risk — read before selecting.',   recommended: false },
} as const
type TierKey = keyof typeof TIER_RATIOS

// Phase H basket = the ONE canonical list (lib/phase-h-basket), sorted for display.
// TON→GRAM rebrand + NEAR/OP propagate here automatically. All tiers trade the same basket.
const ALPHA_BASKET = [...PHASE_H_BASKET].sort()

// Mode = profit handling. Mutually exclusive: at most one of compound / staxs.
type ModeKey = 'fixed' | 'compound' | 'staxs'

// Legacy DB compat: pre-schema users have tier='bold' (1.0× under old mult model). Map to 'aggressive'.
function normalizeTierId(raw: string | undefined | null): TierKey {
  const v = (raw || '').toLowerCase()
  if (v === 'bold') return 'aggressive'
  if (v === 'conservative' || v === 'moderate' || v === 'aggressive' || v === 'kamikaze') return v
  return 'conservative'
}

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

  const tier = normalizeTierId(cfg?.tier || cfg?.preset)
  const lev = cfg?.leverage || TIER_RATIOS[tier].leverage
  const capital = cfg?.activation_balance || cfg?.capital
  const notional = cfg?.hb_base_notional_usd || cfg?.notional

  const tierLabel = ({
    conservative: t('bot.tierConservative'),
    moderate:     t('bot.tierModerate'),
    aggressive:   t('bot.tierAggressive'),
    kamikaze:     t('bot.tierKamikaze'),
  } as Record<TierKey, string>)[tier] || t('bot.tierConservative')

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
//   1. Choose Trading Mode (Conservative / Moderate / Aggressive)
//   2. Set Capital (with Refresh Balance from /api/balance)
//   3. How Sizing Works + Compound mode toggle
//   4. 12-Month Projection (concise — backtest stats per tier)
//   5. Review & Activate (POSTs to /api/bot-activate)
//
// Tier ratios (TIER_RATIOS): Conservative 2+1 lanes × 1× lev × 50% / Moderate 4+1
// lanes × 3× lev × 75% / Aggressive 6+1 lanes × 6× lev × 100% (Tier-grid v2 + super lane).
// SL is 4% across all tiers. Bitget leverage cap matches tier leverage.

// Backtest stats per tier — Phase H 16-asset portfolio (BTC, ETH, SOL, BNB,
// XRP, LINK, SUI, DOGE, AVAX, ADA, TRX, ZEC, TON, HYPE) over 97 months of
// Bitget USDT-FUTURES data (post-funding net, FCFS-gated portfolio).
// Source: msga-replay/swingmate_v3/phase_c_runs/phase_h_cross_asset_portfolio.json
//   full_15_lane_sweep — 2026-05-20 published_at.
//
// 3-lane (Moderate) and 5-lane (Aggressive) come directly from the sweep.
// 2-lane (Conservative) is not in the sweep — estimated at ~70% of 3-lane
// returns based on the lane-count vs. returns curve (4→5 adds 10%, so
// 2→3 ≈ 30% missed).
//
// 2026-06-12: the hardcoded TIER_BACKTEST performance constants are GONE (the
// "6140%" / TIER_META class of bug). Projected Performance now FETCHES the SAME
// canonical dataset the Backtesting page serves — phase-h-risk portfolio-stats.json
// per tier (limit-entry 0.15%/120, risk-sized, 2/4/6 grid) — so page, settings, and
// simulator can never diverge again. The producer (risk_sizing_canonical) carries
// every figure (returnPct/PF/maxDD/trades + WR/avgWin/avgLoss/annual/monthsProfitable);
// accountDdPct = maxDdPct × tier_leverage and the riskPos gauge are derived in-component.
// NO performance number is hardcoded anywhere here.
type BtStats = {
  totalReturnPct: number; annualPct: number; maxDdPct: number; accountDdPct: number
  avgWinPct: number; avgLossPct: number; winRatePct: number; profitFactor: number
  totalTrades: number; monthsProfitable: number; totalMonths: number; riskPos: number
}
const BT_LOADING: BtStats = { totalReturnPct: 0, annualPct: 0, maxDdPct: 0, accountDdPct: 0,
  avgWinPct: 0, avgLossPct: 0, winRatePct: 0, profitFactor: 0, totalTrades: 0,
  monthsProfitable: 0, totalMonths: 0, riskPos: 0 }
const PHASE_H_RISK_BASE = '/data/strategies/phase-h-risk'
function statsUrlForTier(tier: TierKey): string {
  return tier === 'conservative' ? `${PHASE_H_RISK_BASE}/portfolio-stats.json`
    : `${PHASE_H_RISK_BASE}/tiers/${tier}/portfolio-stats.json`
}
function statsToBt(s: any, tier: TierKey): BtStats {
  const lev = TIER_RATIOS[tier].leverage
  const accountDd = Math.round((s?.maxDD || 0) * lev)
  return {
    totalReturnPct: s?.returnPct ?? 0, annualPct: s?.annualPct ?? 0, maxDdPct: s?.maxDD ?? 0,
    accountDdPct: accountDd, avgWinPct: s?.avgWinPct ?? 0, avgLossPct: s?.avgLossPct ?? 0,
    winRatePct: s?.winRatePct ?? 0, profitFactor: s?.profitFactor ?? 0, totalTrades: s?.totalTrades ?? 0,
    monthsProfitable: s?.monthsProfitable ?? 0, totalMonths: s?.totalMonths ?? 0,
    riskPos: Math.min(95, Math.max(8, Math.round(accountDd * 1.5))),
  }
}

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
  const [showBasket, setShowBasket] = useState(false)  // collapsible 16-asset list
  // Mode is mutually exclusive: fixed (default) / compound / staxs.
  // Initial compound flag maps to legacy compound-mode state.
  const [mode, setMode] = useState<ModeKey>(initialCompound ? 'compound' : 'fixed')
  // Picker mode (Gap 2 — custom grid): 'tier' = named Conservative/Moderate/
  // Aggressive cards; 'custom' = the {2,3,4,5,6} lanes × {25,50,75,100%} grid.
  // When 'custom', a selected cell {nLanes, basePct} drives activation via the
  // config.custom carrier; the leverage ceiling greys out unsafe cells.
  const [pickerMode, setPickerMode] = useState<'tier' | 'custom'>('tier')
  const [customSel, setCustomSel] = useState<{ nLanes: number; basePct: number } | null>(null)
  // Disclosure checkboxes (Step 5 — all 4 required for activate)
  const [d1, setD1] = useState(false)  // backtest disclaimer
  const [d2, setD2] = useState(false)  // leverage risk
  const [d3, setD3] = useState(false)  // trade authorisation
  const [d4, setD4] = useState(false)  // performance fee structure
  const [d5, setD5] = useState(false)  // 2026-07-04 KAMIKAZE tail-risk ack (only required when kamikaze selected)
  const [activating, setActivating] = useState(false)
  const [activateMsg, setActivateMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const ratios = TIER_RATIOS[preset]
  // 2026-06-12: bt is FETCHED from phase-h-risk (the same canonical source the
  // Backtesting page serves), not a hardcoded constant. Re-fetches on tier change.
  const [bt, setBt] = useState<BtStats>(BT_LOADING)
  useEffect(() => {
    let alive = true
    fetch(statsUrlForTier(preset), { cache: 'no-store' })
      .then(r => r.json())
      .then(s => { if (alive) setBt(statsToBt(s, preset)) })
      .catch(() => {})
    return () => { alive = false }
  }, [preset])
  const capNum = Math.max(0, Number(capital) || 0)
  // Position size per lane = capital × tier base_pct (Tier-grid v2: Cons 50%,
  //   Mod 75%, Aggr 100%). Nominal leverage = lanes × base_pct (Cons 1×, Mod 3×,
  //   Aggr 6×).
  //
  //   posSize per lane × lanes = capital × base_pct × lanes = max notional exposure.
  //
  // In Fixed and Staxs modes posSize is LOCKED at capital_initial × base_pct —
  // even if the account grows or shrinks. Compound mode scales posSize with
  // balance, capped at COMPOUND_CAP_MULTIPLIER × the per-lane base.
  const posSize = Math.round(capNum * ratios.basePct)  // locked initial per lane;
                          // backend uses current_balance for compound at execute time
  const maxNotional = ratios.lanes * posSize
  const maxLoss = posSize * (ratios.sl / 100)
  const compoundCap = posSize * COMPOUND_CAP_MULTIPLIER
  const reserveTarget = Math.round(capNum * RESERVE_PCT_BY_TIER[preset])
  const overBalance = maxBalance > 0 && capNum > maxBalance
  const allDisclosuresAck = d1 && d2 && d3 && d4 && (preset !== 'kamikaze' || d5)

  // ── Custom grid (Gap 2) effective sizing ──
  // In custom mode the selected cell {nLanes, basePct} overrides the named
  // tier's lanes/leverage. Per-lane notional = basePct × capital (the grid's
  // sizing fraction); nominal leverage = round(nLanes × basePct). When no cell
  // is selected yet, fall back to the named-tier numbers so Steps 2/4/5 still
  // render coherently.
  const isCustom = pickerMode === 'custom'
  const customReady = isCustom && customSel != null
  const effLanes = customReady ? customSel!.nLanes : ratios.lanes
  const effLeverage = customReady ? Math.max(1, Math.round(customSel!.nLanes * customSel!.basePct)) : ratios.leverage
  // Per-lane notional: custom = basePct × capital; named tier = full capital.
  const effPerLane = customReady ? Math.round(customSel!.basePct * capNum) : posSize
  const effMaxNotional = effLanes * effPerLane
  const effMaxLoss = effPerLane * (ratios.sl / 100)
  const effLabel = customReady
    ? `Custom (${customSel!.nLanes}L · ${Math.round(customSel!.basePct * 100)}%)`
    : ratios.label
  // Activation gate: in custom mode a cell must be selected first.
  const selectionReady = !isCustom || customReady

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
    if (isCustom && !customReady) { setActivateMsg({ ok: false, text: 'Select a lanes × sizing cell first.' }); return }
    if (!allDisclosuresAck) { setActivateMsg({ ok: false, text: 'Please acknowledge all disclosures above.' }); return }
    setActivating(true); setActivateMsg(null)
    try {
      // Custom grid carrier — the engine reads bot_assignments.config.custom =
      // { n_lanes, base_pct } and falls back to the named tier when absent.
      // Only sent in custom mode; named-tier path is byte-for-byte unchanged.
      const customFields = customReady
        ? { n_lanes: customSel!.nLanes, base_pct: customSel!.basePct }
        : {}
      await authedFetch('/api/bot-activate', {
        method: 'POST',
        body: JSON.stringify({
          // New Phase H schema (v4)
          tier: preset,
          mode,                            // 'fixed' | 'compound' | 'staxs'
          capital_initial: capNum,
          lanes_active: effLanes,
          leverage_multiplier: effLeverage,
          per_lane_notional_usd: effPerLane,
          compound_enabled: mode === 'compound',
          staxs_enabled: mode === 'staxs',
          compound_cap_usd: mode === 'compound' ? capNum * COMPOUND_CAP_MULTIPLIER : null,
          config_schema_version: 4,
          // Custom lanes × sizing grid (config.custom carrier). Absent → named tier.
          ...customFields,
          // Legacy aliases preserved so the older backend code (lib/tier-sizing.ts,
          // /api/execute-signal) continues to read its expected fields until
          // Phase B lands the schema v4 server-side migration.
          preset,
          capital: capNum,
          leverage: effLeverage,
          notional: effPerLane,
          compound: mode === 'compound',
          smart_sizing_enabled: false,
        }),
      })
      patchWizardState({
        step2_settings_saved: true,
        step3_complete: true,
        trading_mode: isCustom ? `custom_${effLanes}L_${Math.round((customSel?.basePct ?? 1) * 100)}` : preset,
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

      {/* Step 1 — Trading Tier */}
      {step === 1 && (
        <div className="bw-step-body">
          <div className="bw-step-title">Choose Your Trading Tier</div>
          <div className="bw-step-sub">Your tier sets how many positions can run concurrently and the leverage applied. Same systematic strategy across all tiers — only concurrency and risk exposure change.</div>
          <div className="bw-step-meta">
            Staxs trades an 18-cryptocurrency basket using proprietary systematic strategies. Tier choice scales position concurrency, not which assets trade.
          </div>

          <button
            type="button"
            className="bw-toggle-projected"
            onClick={() => setShowBasket(s => !s)}
            style={{ marginBottom: 12 }}
          >
            {showBasket ? '▲ Hide' : '▼ View'} asset basket (18 cryptocurrencies)
          </button>
          {showBasket ? (
            <div className="bw-basket-list" style={{ background: 'var(--bg-soft, rgba(0,0,0,0.04))', border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginBottom: 16, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 13, lineHeight: 1.6, textAlign: 'center' }}>
              {ALPHA_BASKET.join(' · ')}
            </div>
          ) : null}

          {/* Picker mode — named tiers vs custom lanes × sizing grid (Gap 2) */}
          <div className="bw-picker-tabs">
            <button
              type="button"
              className={'bw-picker-tab' + (pickerMode === 'tier' ? ' bw-active' : '')}
              onClick={() => setPickerMode('tier')}
            >
              Preset tiers
            </button>
            <button
              type="button"
              className={'bw-picker-tab' + (pickerMode === 'custom' ? ' bw-active' : '')}
              onClick={() => setPickerMode('custom')}
            >
              Custom grid
            </button>
          </div>

          {pickerMode === 'custom' && (
            <CustomGrid capitalUsd={capNum} sel={customSel} onSelect={setCustomSel} />
          )}

          {pickerMode === 'tier' && (
          <div className="bw-tier-grid">
            {(['conservative', 'moderate', 'aggressive', 'kamikaze'] as const).map(p => {
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
                      : p === 'moderate' ? <SVG><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></SVG>
                      : p === 'aggressive' ? <SVG><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></SVG>
                      : <SVG><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M12 2a8 8 0 0 0-8 8c0 3 2 5 3 6v3a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-3c1-1 3-3 3-6a8 8 0 0 0-8-8z"/><line x1="10" y1="18" x2="10" y2="21"/><line x1="14" y1="18" x2="14" y2="21"/></SVG>}
                  </div>
                  <div className="bw-tier-name">{r.label}</div>
                  <div className="bw-tier-mult">{r.lanes} lanes · {r.leverage}× leverage</div>
                  {/* 2026-09-03 (EC2): the card said "7 lanes" and stopped there. One of them is a
                      seat held in reserve for a top-ranked signal and never evicted, which is the
                      whole point of the re-lock — the customer should be told what they get. */}
                  <div className="bw-tier-sub" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    Max {r.lanes} concurrent position{r.lanes > 1 ? 's' : ''} — {r.ordinary} ordinary + 1 reserved seat
                  </div>
                  <div className="bw-tier-blurb">{r.blurb}</div>
                </button>
              )
            })}
          </div>
          )}

          {pickerMode === 'tier' && (
          <button
            type="button"
            className="bw-toggle-projected"
            onClick={() => setShowProjected(s => !s)}
          >
            {showProjected ? '▲ Hide' : '▼ Show'} Projected Performance
          </button>
          )}
          {pickerMode === 'tier' && showProjected ? (
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
                <ProjStat label="Months Profitable" val={`${bt.monthsProfitable}/${bt.totalMonths}`} />
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
                  Projected for <strong>{TIER_RATIOS[preset].label} tier ({TIER_RATIOS[preset].lanes} lanes · {TIER_RATIOS[preset].leverage}× lev)</strong>
                </div>
              </div>
            </div>
          ) : null}

          <div className="bw-actions" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="bw-btn-primary" onClick={next} disabled={!selectionReady} title={!selectionReady ? 'Select a lanes × sizing cell first' : undefined}>Next →</button>
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
              <div className="bw-position-head">Position Parameters · {effLabel} ({effLanes} lanes / {effLeverage}× lev)</div>
              <div className="bw-position-grid">
                <ProjStat label="Position Size"    val={`$${effPerLane.toLocaleString()}`} sub="per lane (notional)" />
                <ProjStat label="Max Concurrent"   val={`$${effMaxNotional.toLocaleString()}`} sub={`${effLanes} lane${effLanes > 1 ? 's' : ''} total`} />
                <ProjStat label="Stop Loss"        val={`${ratios.sl}%`} sub="per trade" />
                <ProjStat label="Max Loss / Trade" val={`$${Math.round(effMaxLoss).toLocaleString()}`} sub="per lane" negative />
              </div>
            </div>

            <div className="bw-explain">
              {isCustom ? (
                <><strong>How it works:</strong> Each lane uses ${effPerLane.toLocaleString()} notional ({Math.round((customSel?.basePct ?? 0) * 100)}% of your ${capNum.toLocaleString()} capital). {effLanes} lane{effLanes > 1 ? 's' : ''} maximum — at full utilisation that&apos;s ${effMaxNotional.toLocaleString()} of total concurrent exposure ({effLeverage}× nominal leverage). Sub-linear sizing damps real leverage below the nominal figure as your balance grows.</>
              ) : (
                <><strong>How it works:</strong> Each lane uses ${posSize.toLocaleString()} notional ({Math.round(ratios.basePct * 100)}% of your starting capital). {ratios.lanes} lane{ratios.lanes > 1 ? 's' : ''} maximum on {ratios.label} tier — at full utilisation that&apos;s ${maxNotional.toLocaleString()} of total concurrent exposure. Leverage is set to {ratios.leverage}× (tier-matched) — used only to free margin, not to amplify position sizes beyond tier capacity.</>
              )}
            </div>
          </div>

          <div className="bw-actions">
            <button type="button" className="bw-btn-back" onClick={back}>← Back</button>
            <button type="button" className="bw-btn-primary" onClick={next} disabled={overBalance || capNum < 100 || !selectionReady}>Next →</button>
          </div>
        </div>
      )}

      {/* Step 3 — Profit Handling Mode (Fixed / Compound / Staxs) */}
      {step === 3 && (
        <div className="bw-step-body">
          <div className="bw-step-title">Choose Your Profit Handling Mode</div>
          <div className="bw-step-sub">When your account earns profits above your initial deposit, what happens next? Pick one mode below, or leave both off for fixed-position trading.</div>

          {/* Default-state card — visible when both toggles OFF */}
          {mode === 'fixed' ? (
            <div className="bw-control-card" style={{ marginBottom: 14 }}>
              <strong>Default — Fixed Notional.</strong> Position size frozen at setup ({`$${capNum.toLocaleString()} per lane`}). Profits accumulate in your account. 20% performance fee extracted monthly from net profit. Lowest risk scaling.
            </div>
          ) : null}

          {/* Toggle A — Compound */}
          <div className="bw-compound-card" style={{ opacity: mode === 'staxs' ? 0.5 : 1, pointerEvents: mode === 'staxs' ? 'none' : 'auto' }}>
            <div className="bw-compound-head">
              <div>
                <div className="bw-compound-ttl">Compound mode</div>
                <div className="bw-compound-help">
                  Position size scales with your account balance. Wins → bigger positions. Losses → smaller. Hard cap: <strong>{COMPOUND_CAP_MULTIPLIER}× your initial deposit</strong>. Re-setup required to lift cap.
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={mode === 'compound'}
                className={'toggle-switch' + (mode === 'compound' ? ' on' : '')}
                onClick={() => setMode(m => m === 'compound' ? 'fixed' : 'compound')}
                disabled={mode === 'staxs'}
                title={mode === 'staxs' ? 'Cannot combine Compound with Staxs' : undefined}
              >
                <span className="toggle-knob" />
              </button>
            </div>
            <div className="bw-compound-conseq">
              {mode === 'compound'
                ? <><strong>On:</strong> Highest growth potential, highest risk. Capped at ${compoundCap.toLocaleString()} per lane.</>
                : <><strong>Off (default):</strong> Fixed position size at setup.</>
              }
            </div>
          </div>

          {/* Toggle B — Staxs (Satoshi Stacking) */}
          <div className="bw-compound-card" style={{ marginTop: 14, opacity: mode === 'compound' ? 0.5 : 1, pointerEvents: mode === 'compound' ? 'none' : 'auto' }}>
            <div className="bw-compound-head">
              <div>
                <div className="bw-compound-ttl">Staxs — stack BTC automatically</div>
                <div className="bw-compound-help">
                  Trading account stays at deposit size. Monthly profits convert to BTC automatically. USDT safety reserve built from profits. <em>&ldquo;Never sell BTC&rdquo;</em> one-way accumulation.
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={mode === 'staxs'}
                className={'toggle-switch' + (mode === 'staxs' ? ' on' : '')}
                onClick={() => setMode(m => m === 'staxs' ? 'fixed' : 'staxs')}
                disabled={mode === 'compound'}
                title={mode === 'compound' ? 'Cannot combine Compound with Staxs' : undefined}
              >
                <span className="toggle-knob" />
              </button>
            </div>
            <div className="bw-compound-conseq">
              {mode === 'staxs'
                ? <><strong>On:</strong> Best for long-term BTC accumulation.</>
                : <><strong>Off (default):</strong> Profits stay in trading account.</>
              }
            </div>
            {mode === 'staxs' ? (
              <div className="bw-compound-conseq" style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                Backtest: $10k Moderate Staxs accumulated ~$1.5M of BTC over 6.8 years (post-funding).
              </div>
            ) : null}
          </div>

          {/* Worked example — dynamic per (tier, mode) */}
          <div className="bw-worked-card" style={{ marginTop: 14 }}>
            <div className="bw-worked-head">
              Worked example · {ratios.label} tier on ${(capNum || 10000).toLocaleString()} balance
            </div>
            <div className="bw-worked-intro">
              {mode === 'fixed' && (
                <>Each trade: <strong>${capNum.toLocaleString()}</strong> position notional (per lane). Max concurrent: {ratios.lanes} lane{ratios.lanes > 1 ? 's' : ''} = ${maxNotional.toLocaleString()} notional.</>
              )}
              {mode === 'compound' && (
                <>Each trade: <strong>${capNum.toLocaleString()}</strong> initial position notional (per lane). As account grows, positions scale proportionally. Capped at ${compoundCap.toLocaleString()} per lane.</>
              )}
              {mode === 'staxs' && (
                <>Each trade: <strong>${capNum.toLocaleString()}</strong> position notional (per lane), frozen for life. Profits accumulate as BTC in your reserve.</>
              )}
            </div>

            {mode === 'fixed' && (
              <>
                <div className="bw-worked-row">
                  <span>After profits — balance grows to ${(Math.round((capNum || 10000) * 1.4)).toLocaleString()}</span>
                  <span className="num pos-text">positions STAY ${capNum.toLocaleString()} each</span>
                </div>
                <div className="bw-worked-row">
                  <span>20% performance fee extracted monthly from net profit</span>
                  <span className="num">automatic</span>
                </div>
              </>
            )}
            {mode === 'compound' && (
              <>
                <div className="bw-worked-row">
                  <span>After profits — balance ${(Math.round((capNum || 10000) * 1.4)).toLocaleString()}</span>
                  <span className="num pos-text">positions scale to ~${Math.round(capNum * 1.4).toLocaleString()} each</span>
                </div>
                <div className="bw-worked-row">
                  <span>Cap reached at ${compoundCap.toLocaleString()} per lane</span>
                  <span className="num">re-setup wizard required</span>
                </div>
              </>
            )}
            {mode === 'staxs' && (
              <>
                <div className="bw-worked-row">
                  <span>Month-end · balance ${(Math.round(capNum * 1.4)).toLocaleString()} (40% profit)</span>
                  <span className="num">step 1: top-up reserve</span>
                </div>
                <div className="bw-worked-row">
                  <span>USDT reserve target: ${reserveTarget.toLocaleString()} ({Math.round(RESERVE_PCT_BY_TIER[preset] * 100)}% of capital · {ratios.label} tier)</span>
                  <span className="num">step 2: remaining → BTC</span>
                </div>
                <div className="bw-worked-row">
                  <span>Trading account resets to ${capNum.toLocaleString()} for next month</span>
                  <span className="num pos-text">BTC stack grows, never sold</span>
                </div>
              </>
            )}
          </div>

          {/* "You stay in control" callout */}
          <div className="bw-control-card" style={{ marginTop: 14 }}>
            <strong>You stay in control.</strong> You can switch tiers and modes anytime, and withdrawing from your exchange reduces exposure proportionally. Compound and Staxs are mutually exclusive — pick one or neither.
          </div>

          {/* Compound drawdown warning — only when compound mode is ON */}
          {mode === 'compound' ? (
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
          <div className="bw-step-sub">Based on the 16-asset Phase H portfolio backtest (6.8 years post-funding Bitget USDT-FUTURES data). Past performance does not predict future results.</div>

          {isCustom ? (
            <>
              <div className="bw-proj-row">
                <ProjStat label="Lanes × Sizing" val={`${effLanes}L · ${Math.round((customSel?.basePct ?? 0) * 100)}%`} sub="custom grid selection" big />
                <ProjStat label="Nominal Leverage" val={`${effLeverage}×`} sub={`${effLanes} lanes × ${Math.round((customSel?.basePct ?? 0) * 100)}% sizing`} big />
                <ProjStat label="Max Concurrent" val={`$${effMaxNotional.toLocaleString()}`} sub={`${effLanes} lanes × $${effPerLane.toLocaleString()}`} big />
              </div>
              <div className="bw-proj-row">
                <ProjStat label="Risk per Trade" val={`$${Math.round(effMaxLoss).toLocaleString()}`} sub={`${ratios.sl}% × $${effPerLane.toLocaleString()} per lane`} negative />
                <ProjStat label="Per-Lane Notional" val={`$${effPerLane.toLocaleString()}`} sub="at setup balance" />
                <ProjStat label="Account Leverage Req." val={`≥ ${effLeverage}×`} sub="set on Bitget BTCUSDT" />
              </div>
              <div className="bw-control-card" style={{ marginTop: 14 }}>
                <strong>Custom combo.</strong> Per-cell backtest projections aren&apos;t shown for custom lanes × sizing — only the preset tiers (Conservative / Moderate / Aggressive) have full validated backtests. Your selection sits at {effLeverage}× nominal leverage (within the stress-validated 6× ceiling). Sub-linear sizing keeps real peak leverage below the nominal figure as the account grows.
              </div>
            </>
          ) : (
          <>
          <div className="bw-proj-row">
            <ProjStat
              label="Projected Return"
              val={`+$${Math.round(capNum * (bt.annualPct / 100)).toLocaleString()}`}
              sub={`+${bt.annualPct.toFixed(0)}% (12-month avg from 7Y backtest)`}
              positive
              big
            />
            <ProjStat
              label="Est. Ending Balance"
              val={`$${Math.round(capNum * (1 + bt.annualPct / 100)).toLocaleString()}`}
              sub={`from $${capNum.toLocaleString()}`}
              big
            />
            {/* Profitable Months — a more compelling signal than Win Rate.
                "We were green in X out of Y months" speaks to consistency in
                a way per-trade win rate can't. Pulled straight from the same
                Phase H backtest as the other numbers on this page. */}
            <ProjStat
              label="Profitable Months"
              val={`${Math.round((bt.monthsProfitable / bt.totalMonths) * 100)}%`}
              sub={`${bt.monthsProfitable} of ${bt.totalMonths} months green`}
              positive
              big
            />
          </div>

          {/* Account-level DD = peak portfolio DD × leverage (3× on Moderate ≈ ~23%) */}
          <div className="bw-proj-row">
            <ProjStat
              label="Max Drawdown"
              val={`-${bt.accountDdPct}%`}
              sub={`peak portfolio DD ${bt.maxDdPct.toFixed(1)}% × ${ratios.leverage}× lev`}
              negative
            />
            <ProjStat
              label="Liquidation Risk"
              val={preset === 'conservative' ? 'Very Low' : preset === 'moderate' ? 'Low' : 'Moderate'}
              sub={preset === 'conservative' ? '~50% adverse to liquidate' : preset === 'moderate' ? '~30% adverse to liquidate' : '~20% adverse to liquidate'}
              positive={preset !== 'aggressive'}
            />
            <ProjStat
              label="Risk per Trade"
              val={`$${Math.round(maxLoss).toLocaleString()}`}
              sub={`${ratios.sl}% × $${posSize.toLocaleString()} per lane`}
            />
          </div>

          {mode === 'staxs' ? (
            <div className="bw-control-card" style={{ marginTop: 14 }}>
              <strong>Staxs mode note:</strong> projected return shown above is the trading-account growth equivalent. Under Staxs, that profit converts to BTC monthly — your actual customer value = trading account ({`$${capNum.toLocaleString()}`} steady) + USDT reserve + accumulated BTC stack.
            </div>
          ) : null}
          {mode === 'compound' ? (
            <div className="bw-control-card" style={{ marginTop: 14 }}>
              <strong>Compound mode note:</strong> 12-month projection compounds monthly. Cap at {COMPOUND_CAP_MULTIPLIER}× initial deposit (${(capNum * COMPOUND_CAP_MULTIPLIER).toLocaleString()} per lane) constrains the curve once reached.
            </div>
          ) : null}

          <div className="bw-risk-band">
            <div className="bw-risk-track" />
            <div className="bw-risk-dot" style={{ left: `${bt.riskPos}%` }} />
            <div className="bw-risk-ends">
              <span>Conservative</span>
              <span>Moderate</span>
              <span>Aggressive</span>
            </div>
          </div>

          <div className="bw-disclaimer">These projections are based on historical backtests. Actual results may vary. Never invest more than you can afford to lose.</div>
          </>
          )}

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
            <div className="bw-review-row"><span>{isCustom ? 'Configuration' : 'Tier'}</span><span>{effLabel} ({effLanes} lanes / {effLeverage}× leverage)</span></div>
            <div className="bw-review-row"><span>Starting Capital</span><span className="num">${capNum.toLocaleString()}</span></div>
            <div className="bw-review-row"><span>Position Size</span><span className="num">${effPerLane.toLocaleString()} per lane</span></div>
            <div className="bw-review-row"><span>Max Concurrent</span><span className="num">{effLanes} lane{effLanes > 1 ? 's' : ''} = ${effMaxNotional.toLocaleString()} notional</span></div>
            <div className="bw-review-row"><span>Stop Loss</span><span className="num">{ratios.sl}% per position</span></div>
            <div className="bw-review-row"><span>Max Loss / Trade</span><span className="num neg-text">-${Math.round(effMaxLoss).toLocaleString()} per lane</span></div>
            <div className="bw-review-row"><span>Bitget Leverage</span><span className="num">{effLeverage}× {isCustom ? '(nominal)' : '(tier-matched)'}</span></div>
            <div className="bw-review-row"><span>Mode</span><span>{mode === 'fixed' ? 'Fixed Notional (default)' : mode === 'compound' ? `Compound (cap $${(capNum * COMPOUND_CAP_MULTIPLIER).toLocaleString()})` : 'Staxs — Satoshi Stacking'}</span></div>
            <div className="bw-review-row"><span>Fee Structure</span><span>20% of monthly net profit</span></div>
            {!isCustom ? (
              <>
                <div className="bw-review-row" style={{ borderTop: '1px solid var(--line)', marginTop: 4, paddingTop: 8 }}>
                  <span>Projected Return (12-month avg)</span>
                  <span className="num pos-text">+${Math.round(capNum * (bt.annualPct / 100)).toLocaleString()}</span>
                </div>
                <div className="bw-review-row"><span>Expected Max DD</span><span className="num neg-text">~-{bt.accountDdPct}% on account</span></div>
              </>
            ) : (
              <div className="bw-review-row" style={{ borderTop: '1px solid var(--line)', marginTop: 4, paddingTop: 8 }}>
                <span>Nominal Leverage</span>
                <span className="num">{effLeverage}× (within 6× safe ceiling)</span>
              </div>
            )}
            <div className="bw-review-row"><span>Exchange</span><span>Bitget USDT-M Futures</span></div>
            <div className="bw-review-row"><span>API Status</span><span className="pos-text">✓ Trading enabled · ✓ Withdrawal disabled</span></div>
          </div>

          {/* Mandatory disclosure checkboxes */}
          <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-soft, rgba(0,0,0,0.04))', border: '1px solid var(--line)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--muted)', marginBottom: 8 }}>Required Disclosures</div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '6px 0', fontSize: 13 }}>
              <input type="checkbox" checked={d1} onChange={e => setD1(e.target.checked)} style={{ marginTop: 3 }} />
              <span>I understand backtest results do not guarantee future performance.</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '6px 0', fontSize: 13 }}>
              <input type="checkbox" checked={d2} onChange={e => setD2(e.target.checked)} style={{ marginTop: 3 }} />
              <span>I understand leveraged trading can result in losses, including amounts exceeding initial deposit in extreme scenarios.</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '6px 0', fontSize: 13 }}>
              <input type="checkbox" checked={d3} onChange={e => setD3(e.target.checked)} style={{ marginTop: 3 }} />
              <span>I authorize Staxs to execute trades on my Bitget account using the connected API key.</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '6px 0', fontSize: 13 }}>
              <input type="checkbox" checked={d4} onChange={e => setD4(e.target.checked)} style={{ marginTop: 3 }} />
              <span>I understand the 20% performance fee is applied to net profit only — no fees on losses.</span>
            </label>
            {/* 2026-09-02 SUPER LANE — a real, new product feature and nothing on this page said
                so. Every tier now carries its ordinary lanes PLUS one reserved seat that only a
                protected strategy can take, which raises the worst-case exposure by one lane. */}
            <div style={{ marginTop: 10, padding: 10, background: 'rgba(212,160,23,0.06)', border: '1px solid rgba(212,160,23,0.28)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gold)', marginBottom: 6 }}>Reserved lane</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text)' }}>
                {TIER_RATIOS[preset as TierKey]?.label} runs <strong>{TIER_RATIOS[preset as TierKey]?.ordinary} ordinary lanes plus 1 reserved lane</strong> ({TIER_RATIOS[preset as TierKey]?.lanes} total).
                The reserved lane can only be taken by one of the strategies the book protects, so a
                high-quality signal is never crowded out by ordinary trades. Your position size per
                trade is unchanged — the reserved lane is extra capacity, which means at full
                occupancy your exposure is {TIER_RATIOS[preset as TierKey]?.lanes} positions rather
                than {TIER_RATIOS[preset as TierKey]?.ordinary}.
              </div>
            </div>
            {/* 2026-07-04 KAMIKAZE tail-risk panel + mandatory ack — shown ONLY when the Kamikaze tier is selected. */}
            {preset === 'kamikaze' ? (
              <div style={{ marginTop: 10, padding: 10, background: 'rgba(255,77,79,0.06)', border: '1px solid rgba(255,77,79,0.30)', borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--neg, #ff4d4f)', marginBottom: 6 }}>⚠ Kamikaze — Disclosed Tail Risk</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text)' }}>
                  KAMIKAZE (8 lanes — 7 ordinary + 1 reserved / 1.25×) — worst observed 7-year case is a ~61–68% drawdown week (full books occur roughly weekly on volatility events). A beyond-record simultaneous ≥2× gap-through event would be fatal below ~$50k. Minimum account is set by order mechanics (~$1k), NOT by a safety threshold — no account size makes this tier safe from its tail. Position sizing risks ~6.25% of configured capital per trade.
                </div>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '8px 0 2px', fontSize: 13, fontWeight: 600 }}>
                  <input type="checkbox" checked={d5} onChange={e => setD5(e.target.checked)} style={{ marginTop: 3 }} />
                  <span>I understand the Kamikaze tail risk — a beyond-record gap event can be fatal at any account size.</span>
                </label>
              </div>
            ) : null}
          </div>

          {activateMsg ? (
            <div className={activateMsg.ok ? 'pos-text' : 'neg-text'} style={{ fontSize: 13, fontWeight: 600, padding: '10px 12px', background: activateMsg.ok ? 'rgba(46,204,113,0.06)' : 'rgba(255,77,79,0.06)', border: '1px solid ' + (activateMsg.ok ? 'rgba(46,204,113,0.22)' : 'rgba(255,77,79,0.22)'), borderRadius: 8 }}>
              {activateMsg.text}
            </div>
          ) : null}

          <button type="button" className="bw-btn-activate" onClick={activateBot} disabled={activating || !allDisclosuresAck}>
            {activating ? 'Activating…' : 'Activate Staxs Bot →'}
          </button>

          {/* Single full-width Back button */}
          <button type="button" className="bw-btn-back-wide" onClick={back}>← Back to Review Projection</button>
        </div>
      )}
    </div>
  )
}

// ─── Custom lanes × sizing grid (Gap 2) ──────────────────────────────────────
// Rows = lanes {2,3,4,5}, columns = sizing {25,50,75,100%}. buildCeilingGrid
// runs the SAME pure validator the server enforces in /api/bot-activate, so the
// greyed-out (unsafe) cells here exactly mirror the server-side rejections.
// Safe cells show nominal leverage + per-lane $ and are clickable; unsafe cells
// are disabled with the rejection reason on hover (title attr).
function CustomGrid({
  capitalUsd, sel, onSelect,
}: {
  capitalUsd: number
  sel: { nLanes: number; basePct: number } | null
  onSelect: (s: { nLanes: number; basePct: number }) => void
}) {
  // accountLeverage = 0 → skip the per-account cap here; the 6× safe ceiling
  // still applies, and /api/bot-activate runs the Bitget pre-flight separately.
  const grid = buildCeilingGrid(capitalUsd || 0, 0)
  const pctCols = [0.25, 0.5, 0.75, 1.0]
  return (
    <div className="bw-cg-wrap">
      <div className="bw-cg-legend">
        <span className="bw-cg-legend-row"><span className="bw-cg-swatch bw-cg-safe" /> Available</span>
        <span className="bw-cg-legend-row"><span className="bw-cg-swatch bw-cg-unsafe" /> Exceeds 6× ceiling</span>
        <span className="bw-cg-legend-row"><span className="bw-cg-swatch bw-cg-on" /> Selected</span>
      </div>
      <div className="bw-cg-grid" style={{ gridTemplateColumns: `auto repeat(${pctCols.length}, 1fr)` }}>
        {/* Header row */}
        <div className="bw-cg-corner">Lanes \ Sizing</div>
        {pctCols.map(p => (
          <div key={`h-${p}`} className="bw-cg-colhead">{Math.round(p * 100)}%</div>
        ))}
        {/* Body rows */}
        {grid.map(row => (
          <Fragment key={`r-${row.nLanes}`}>
            <div className="bw-cg-rowhead">{row.nLanes} lanes</div>
            {row.cells.map(cell => {
              const selected = sel != null && sel.nLanes === row.nLanes && Math.abs(sel.basePct - cell.basePct) < 1e-9
              const cls = 'bw-cg-cell'
                + (cell.safe ? ' bw-cg-safe' : ' bw-cg-unsafe')
                + (selected ? ' bw-cg-on' : '')
              return (
                <button
                  key={`c-${row.nLanes}-${cell.basePct}`}
                  type="button"
                  className={cls}
                  disabled={!cell.safe}
                  aria-pressed={selected}
                  title={cell.message}
                  onClick={() => cell.safe && onSelect({ nLanes: row.nLanes, basePct: cell.basePct })}
                >
                  {cell.safe ? (
                    <>
                      <span className="bw-cg-lev">{cell.nominalLeverage.toFixed(1)}×</span>
                      <span className="bw-cg-notional">${Math.round(cell.perLaneNotionalUsd).toLocaleString()}/lane</span>
                    </>
                  ) : (
                    <span className="bw-cg-x">✕</span>
                  )}
                </button>
              )
            })}
          </Fragment>
        ))}
      </div>
      <div className="bw-cg-help">
        Each cell = how many concurrent lanes × what fraction of your capital each lane bets.
        Nominal leverage = lanes × sizing; combos above the stress-validated 6× ceiling are disabled.
        Per-lane $ assumes your current capital (capped at ${(25000).toLocaleString()}/lane).
      </div>
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

  // ── Notification log (paginated, persistent)
  // Pre-2026-05-09 the log filtered out anything > 24h old (auto-dismiss
  // for the bell badge). Per user feedback, the history should now persist
  // — every signal, all the way back. Bell still uses 24h client-side; the
  // settings log shows the full history with 10-per-page pagination.
  const [logItems, setLogItems] = useState<NotifLogItem[]>([])
  const [logState, setLogState] = useState<'loading' | 'ready' | 'error' | 'empty'>('loading')
  const [logErrorCode, setLogErrorCode] = useState<string>('')
  const [logRefreshing, setLogRefreshing] = useState(false)
  const [logPage, setLogPage] = useState(1)
  const LOG_PAGE_SIZE = 10

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
  // Pulls /api/trades?limit=500 (the user's full notification history) and
  // keeps every entry. The 24h auto-dismiss only applies to the bell badge
  // count, not this settings page — users want to scroll all the way back.
  const loadLog = useCallback(async (manual: boolean = false) => {
    if (manual) setLogRefreshing(true)
    else setLogState('loading')
    try {
      const j = await authedFetch<{ notifications: NotifLogItem[] }>('/api/trades?limit=500')
      const items = (j?.notifications || []).filter(n => !!n.timestamp)
      // Sort newest-first defensively in case the API doesn't.
      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      setLogItems(items)
      setLogState(items.length ? 'ready' : 'empty')
      // Reset to page 1 on every load so a fresh refresh shows the newest items.
      setLogPage(1)
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
      {/* Switched from CSS-grid + display:contents to a real <table> 2026-05-09.
          The grid version had per-cell border-tops that visually fragmented
          under the EMAIL/TELEGRAM column headers — the line looked broken.
          A table gives one continuous border per row + clean column alignment. */}
      <div className="card card-pad">
        <div className="bt-card-head">
          <div className="bt-card-title"><span className="bt-card-bar" />{tt('NOTIFICATIONS', 'NOTIFICAÇÕES')}</div>
        </div>
        <table className="notif-prefs-table">
          <thead>
            <tr>
              <th />
              <th className="notif-col-cb">{tt('Email', 'E-mail')}</th>
              <th className="notif-col-cb">{tt('Telegram', 'Telegram')}</th>
            </tr>
          </thead>
          <tbody>
            {PREF_EVENTS.map(ev => (
              <tr key={ev.key}>
                <td className="notif-prefs-name">
                  <div className="pref-label">{isPt ? ev.labelPt : ev.labelEn}</div>
                  <div className="pref-help">{isPt ? ev.helpPt : ev.helpEn}</div>
                </td>
                <td className="notif-col-cb">
                  <input
                    type="checkbox"
                    className="notif-cb"
                    checked={!!prefs[ev.key]}
                    onChange={e => togglePref(ev.key, e.target.checked)}
                  />
                </td>
                <td className="notif-col-cb">
                  <input
                    type="checkbox"
                    className="notif-cb tg"
                    checked={!!prefs[`tg_${ev.key}`]}
                    disabled={!tgLinked}
                    onChange={e => togglePref(`tg_${ev.key}`, e.target.checked)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Notification Log ───────────────────────────────────────── */}
      {/* Persistent history (no 24h cap) + 10-per-page pagination.
          Icons are SVG (gold lightning for entries, glowing dot for exits)
          ported from v1 client-dashboard.html getNotifIconMarkup. */}
      <div className="card card-pad">
        <div className="notif-log-head">
          <div>
            <div className="bt-card-title"><span className="bt-card-bar" />{tt('NOTIFICATION LOG', 'HISTÓRICO DE NOTIFICAÇÕES')}</div>
            <div className="notif-log-head-meta">
              {tt('Full history of trades, billing, and broker payouts.', 'Histórico completo de trades, cobrança e comissões.')}
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
            logItems.slice((logPage - 1) * LOG_PAGE_SIZE, logPage * LOG_PAGE_SIZE).map(n => (
              <div key={n.id} className="notif-log-row">
                <NotifIcon n={n} />
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

        {/* Pagination footer — appears only when there are more than one page */}
        {logState === 'ready' && logItems.length > LOG_PAGE_SIZE ? (
          <div className="notif-log-pagination">
            <button
              type="button"
              className="settings-btn-secondary"
              disabled={logPage <= 1}
              onClick={() => setLogPage(p => Math.max(1, p - 1))}
            >
              ← {tt('Prev', 'Anterior')}
            </button>
            <span className="notif-log-pagination-info">
              {tt('Page', 'Página')} {logPage} {tt('of', 'de')} {Math.ceil(logItems.length / LOG_PAGE_SIZE)} · {logItems.length} {tt('total', 'total')}
            </span>
            <button
              type="button"
              className="settings-btn-secondary"
              disabled={logPage >= Math.ceil(logItems.length / LOG_PAGE_SIZE)}
              onClick={() => setLogPage(p => Math.min(Math.ceil(logItems.length / LOG_PAGE_SIZE), p + 1))}
            >
              {tt('Next', 'Próxima')} →
            </button>
          </div>
        ) : null}
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
      window.location.href = 'https://staxs.ai/login'
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

// ─── Tour ───────────────────────────────────────────────────────────────────

/**
 * Tour panel — lets a user replay either onboarding tour on demand. Mirrors
 * legacy obsidian-dashboard.html "Replay Full Tour" but split into the two
 * canonical tours from OnboardingTour.tsx.
 *
 * Replays use forceTour to bypass the dismissed/completed wizard flags so
 * the tour fires regardless of state. They don't write any wizard state
 * back when closed — that's reserved for the first auto-fired run.
 *
 * If the user lands here while a tour is auto-firing on the dashboard, we
 * still let them replay from here — a manual replay always wins.
 */
function TourPanel({ active }: { active: boolean }) {
  const { state } = useWizardState()
  const [replay, setReplay] = useState<'tour1' | 'tour2' | null>(null)
  // If the user opens the Tour panel before they've done anything, give
  // them a hint of where each tour fits. The dashboard tour only highlights
  // real widgets, so previewing it from Settings would mostly miss its
  // targets — we navigate to the dashboard with a `?replay=tourN` flag
  // instead so it spotlights real elements.
  function openOnDashboard(which: 'tour1' | 'tour2') {
    try { sessionStorage.setItem('staxs-replay-tour', which) } catch {}
    window.location.href = '/?replayTour=' + which
  }
  if (!active) return null
  return (
    <div className="card card-pad settings-card">
      <h2 className="settings-card-title">Onboarding Tour</h2>
      <p className="settings-card-sub">
        Replay either guided walkthrough at any time. Tour 1 covers the dashboard before bot activation;
        tour 2 covers it after, when live trading data is flowing.
      </p>

      <div className="settings-field" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="settings-btn-primary"
          onClick={() => openOnDashboard('tour1')}
          disabled={!state.step1_complete}
          title={!state.step1_complete ? 'Connect your exchange first — this tour spotlights live dashboard widgets.' : undefined}
        >
          Replay Tour 1 — Dashboard Walkthrough
        </button>
        <div className="settings-field-help">
          The 6-step intro tour: balance, PnL, bot status, and mission tracker.
        </div>
      </div>

      <div className="settings-field" style={{ marginTop: 14 }}>
        <button
          type="button"
          className="settings-btn-primary"
          onClick={() => openOnDashboard('tour2')}
          disabled={!state.step3_complete}
          title={!state.step3_complete ? 'Activate your bot first — this tour spotlights live trading widgets.' : undefined}
        >
          Replay Tour 2 — Live Trading Walkthrough
        </button>
        <div className="settings-field-help">
          The post-activation tour: open positions, equity curve, recent trades, win rate, mission progress.
        </div>
      </div>

      <div className="settings-card-meta" style={{ marginTop: 18 }}>
        <span>Tour 1: {state.tour1_complete ? 'Completed' : state.tour1_dismissed ? 'Dismissed' : 'Not yet seen'}</span>
        <span style={{ margin: '0 8px', color: 'var(--muted-2)' }}>·</span>
        <span>Tour 2: {state.tour2_complete ? 'Completed' : state.tour2_dismissed ? 'Dismissed' : 'Not yet seen'}</span>
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
