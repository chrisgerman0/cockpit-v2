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

function BotPanel() {
  const t = useT()
  const [cfg, setCfg] = useState<BotConfig | null>(null)
  const [activated, setActivated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const loadConfig = useCallback(async () => {
    try {
      const j = await authedFetch<{ activated: boolean; config: BotConfig | null }>('/api/bot-activate')
      setCfg(j?.config || null)
      setActivated(!!j?.activated)
    } catch { /* keep current state — will show empty defaults */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  const tier = (cfg?.tier || cfg?.preset || 'conservative') as 'conservative' | 'bold' | 'aggressive'
  const lev = cfg?.leverage || TIER_LEVERAGE[tier]
  const capital = cfg?.activation_balance || cfg?.capital
  const notional = cfg?.hb_base_notional_usd || cfg?.notional

  const tierLabel = ({
    conservative: t('bot.tierConservative'),
    bold: t('bot.tierBold'),
    aggressive: t('bot.tierAggressive'),
  } as any)[tier] || t('bot.tierConservative')

  async function changeTier(next: 'conservative' | 'bold' | 'aggressive') {
    if (saving || next === tier) return
    setSaving(true); setSaveMsg(null)
    try {
      // POST /api/bot-activate — uses existing capital. Server derives all
      // sizing from the tier (incl. leverage, hb_base_notional_usd, etc.).
      await authedFetch('/api/bot-activate', {
        method: 'POST',
        body: JSON.stringify({
          preset: next,
          capital: capital || 1000,
          notional: notional || 1000,
          compound: !!cfg?.compound,
          smart_sizing_enabled: !!cfg?.smart_sizing_enabled,
        }),
      })
      setSaveMsg({ ok: true, text: `Tier set to ${next}.` })
      await loadConfig()
    } catch (e: any) {
      const raw = String(e?.message || '')
      let msg = 'Failed to change tier.'
      const j = raw.match(/\{.*\}/)
      if (j) { try { msg = JSON.parse(j[0])?.error || msg } catch {} }
      setSaveMsg({ ok: false, text: msg })
    } finally {
      setSaving(false)
    }
  }

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
            {capital ? <BotRow label="Capital" value={`$${Number(capital).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} /> : null}
            {notional ? <BotRow label={t('bot.notional')} value={`$${Number(notional).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} /> : null}
          </div>

          {/* Inline tier change — runs Bitget pre-flight server-side */}
          <div style={{ marginTop: 18 }}>
            <div className="settings-help" style={{ marginBottom: 8 }}>Change tier</div>
            <div className="bt-tier-pills">
              {(['conservative', 'bold', 'aggressive'] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  className={'bt-tier-pill' + (tier === p ? ' active' : '')}
                  disabled={saving}
                  onClick={() => changeTier(p)}
                >
                  {p === 'conservative' ? t('bot.tierConservative') : p === 'bold' ? t('bot.tierBold') : t('bot.tierAggressive')}
                  <span style={{ opacity: 0.55, marginLeft: 6, fontSize: 10 }}>{TIER_LEVERAGE[p]}×</span>
                </button>
              ))}
            </div>
            {saveMsg ? (
              <div className={saveMsg.ok ? 'pos-text' : 'neg-text'} style={{ fontSize: 12, marginTop: 8 }}>{saveMsg.text}</div>
            ) : null}
          </div>

          <div style={{ borderTop: '1px solid var(--line)', marginTop: 22, paddingTop: 16 }}>
            <div className="settings-help" style={{ marginBottom: 8 }}>
              First-time setup or want to reconnect Bitget keys?
            </div>
            <Link
              href="/onboarding"
              prefetch
              className="settings-btn-primary"
              style={{ display: 'inline-flex', textDecoration: 'none', alignItems: 'center', gap: 6 }}
            >
              {t('bot.openWizard')}
            </Link>
          </div>
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
