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

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
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
        <div className="settings-panel">
          {tab === 'profile'       && <ProfilePanel />}
          {tab === 'billing'       && <BillingPanel />}
          {tab === 'bot'           && <BotPanel />}
          {tab === 'notifications' && <NotificationsPanel />}
          {tab === 'security'      && <SecurityPanel />}
          {tab === 'payout'        && <PayoutPanel />}
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

function BillingPanel() {
  const t = useT()
  const [plan, setPlan] = useState<{ name: string; status: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await authedFetch('/api/check-subscription')
        if (!r.ok) throw new Error('subscription fetch failed')
        const j = await r.json()
        if (cancelled) return
        const pn = j?.subscription?.plan || j?.plan || 'Free'
        const st = j?.subscription?.status || j?.status || 'inactive'
        setPlan({ name: pn, status: st })
      } catch {
        if (!cancelled) setPlan({ name: 'Free', status: 'inactive' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="card card-pad settings-card">
      <h3 className="settings-card-title">{t('billing.title')}</h3>
      <div className="billing-status">
        <div className="billing-row">
          <span className="billing-label">{t('billing.currentPlan')}</span>
          <span className="billing-plan">{loading ? t('common.loading') : (plan?.name || t('billing.free'))}</span>
        </div>
        <div className="billing-help">{t('billing.upgrade')}</div>
      </div>
      <a href="/subscribe" className="settings-btn-primary" style={{ display: 'inline-block', textDecoration: 'none' }}>
        {plan?.status === 'active' ? t('billing.managePlan') : t('billing.subscribe')}
      </a>
    </div>
  )
}

// ─── Bot ────────────────────────────────────────────────────────────────────

function BotPanel() {
  const t = useT()
  const [cfg, setCfg] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await authedFetch('/api/bot-config')
        if (r.ok) {
          const j = await r.json()
          if (!cancelled) setCfg(j?.bot_config || null)
        }
      } catch {}
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  const tier = cfg?.tier || 'conservative'
  const lev = cfg?.leverage || 4
  const notional = cfg?.hb_base_notional_usd
  const activated = !!cfg?.activated

  const tierLabel = ({
    conservative: t('bot.tierConservative'),
    bold: t('bot.tierBold'),
    aggressive: t('bot.tierAggressive'),
  } as any)[tier] || t('bot.tierConservative')

  return (
    <div className="card card-pad settings-card">
      <h3 className="settings-card-title">{t('bot.title')}</h3>
      {loading ? (
        <div className="settings-help">{t('common.loading')}</div>
      ) : (
        <>
          <div className="bot-summary">
            <BotRow label={t('bot.status')} value={
              <span className={activated ? 'pos-text' : 'neg-text'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {activated ? <span className="dot-live" /> : null}
                {activated ? t('bot.active') : t('bot.notActivated')}
              </span>
            } />
            <BotRow label={t('bot.tier')} value={<span className="bot-tier-pill">{tierLabel}</span>} />
            <BotRow label={t('bot.leverage')} value={`${lev}×`} />
            {notional ? <BotRow label={t('bot.notional')} value={`$${Number(notional).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} /> : null}
          </div>
          <div className="settings-help" style={{ marginTop: 16 }}>
            {t('bot.openWizard')}
          </div>
          <a href="/?setup=bot" className="settings-btn-primary" style={{ marginTop: 8, display: 'inline-block', textDecoration: 'none' }}>
            {t('bot.openWizard')}
          </a>
        </>
      )}
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

function NotificationsPanel() {
  const t = useT()
  const [prefs, setPrefs] = useState({ trades: true, weekly: true, system: true })

  return (
    <div className="card card-pad settings-card">
      <h3 className="settings-card-title">{t('notif.title')}</h3>
      <div className="notif-list">
        <ToggleRow
          label={t('notif.tradeAlerts')}
          help={t('notif.tradeAlertsHelp')}
          checked={prefs.trades}
          onChange={v => setPrefs(p => ({ ...p, trades: v }))}
        />
        <ToggleRow
          label={t('notif.weeklyReport')}
          help={t('notif.weeklyHelp')}
          checked={prefs.weekly}
          onChange={v => setPrefs(p => ({ ...p, weekly: v }))}
        />
        <ToggleRow
          label={t('notif.systemAlerts')}
          help={t('notif.systemHelp')}
          checked={prefs.system}
          onChange={v => setPrefs(p => ({ ...p, system: v }))}
        />
      </div>
      <div className="settings-help" style={{ marginTop: 12 }}>
        Telegram channel + email integration is configured in the wizard. Toggles here control which events get sent.
      </div>
    </div>
  )
}

function ToggleRow({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle-row">
      <div>
        <div className="toggle-label">{label}</div>
        <div className="toggle-help">{help}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={'toggle-switch' + (checked ? ' on' : '')}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle-knob" />
      </button>
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
