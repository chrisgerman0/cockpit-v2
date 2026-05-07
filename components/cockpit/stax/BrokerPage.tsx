'use client'

/**
 * Broker page — full port of the v1 staxs-landing BrokerDashboard
 * (components/broker-dashboard.tsx) into v2 design tokens.
 *
 * Behaviour parity:
 *   - Reads /api/broker/dashboard for broker profile, summary, per-user
 *     breakdown and payout ledger (auto-approved model).
 *   - Animated count-up on the 6 stat cards.
 *   - 5-tier AUM ladder (Starter 20% → Elite 50%) — current tier is highlighted
 *     and pulses; locked tiers above current AUM are dimmed.
 *   - AUM progress strip towards the next tier.
 *   - Past Payouts + Request Payout twin row (min $20, calls
 *     /api/broker/request-payout with { amount }).
 *   - Referral Performance table with all/active/inactive filter, totals row,
 *     and AUM / Fees Generated / Your Share columns.
 *   - "How You Earn" 3-step explainer.
 *   - Tier Summary table with active row tinted.
 *   - Collapsible Payout Ledger with Date / User / Amount / Method / Status.
 *
 * Visuals:
 *   - .stax-page wrapper, .bt-header hero, .card.card-pad bodies, .bt-tier-pills
 *     filters, .bt-stat-table for tier summary, all per DESIGN_SYSTEM.md.
 *   - All colours via CSS vars; no hardcoded hex.
 *   - Inline SVG icons (no lucide dep — v2 doesn't have it).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { authedFetch } from '@/lib/api'
import { getCurrentLang } from '@/lib/i18n'
import { Icons } from './Icons'

// ─── Types (mirror /api/broker/dashboard route) ─────────────────────────────

interface BrokerUser {
  email: string
  name: string
  plan: string
  status: string
  total_pnl_cents: number
  total_fees_cents: number
  broker_share_cents: number
  joined: string
}

interface BrokerPayout {
  period?: string
  user_email?: string
  user_name?: string
  fee_amount_cents?: number
  split_pct?: number
  payout_amount_cents?: number
  amount_cents?: number
  status: string
  claimable?: boolean
  invoice_paid?: boolean
  created_at: string
  paid_at?: string | null
  method?: string
}

interface BrokerData {
  broker: { name: string; split_pct: number; status: string; referral_code: string | null }
  summary: {
    total_users: number
    active_users: number
    total_capital: number
    total_pnl_cents: number
    total_fees_cents: number
    total_earnings_cents: number
    pending_cents: number
    paid_cents: number
    failed_cents: number
    last_payout_date: string | null
  }
  users: BrokerUser[]
  payouts: BrokerPayout[]
}

// ─── Tier ladder (verbatim from v1) ─────────────────────────────────────────

const TIERS = [
  { name: 'Starter',  range: '$0 - $10K',     min: 0,        max: 10_000,   pct: 20, icon: 'circle' },
  { name: 'Silver',   range: '$10K - $25K',   min: 10_000,   max: 25_000,   pct: 25, icon: 'shield' },
  { name: 'Gold',     range: '$25K - $50K',   min: 25_000,   max: 50_000,   pct: 30, icon: 'star' },
  { name: 'Platinum', range: '$50K - $100K',  min: 50_000,   max: 100_000,  pct: 40, icon: 'trophy' },
  { name: 'Elite',    range: '$100K+',        min: 100_000,  max: Infinity, pct: 50, icon: 'gem' },
] as const

function getTier(aum: number) {
  for (let i = TIERS.length - 1; i >= 0; i--) if (aum >= TIERS[i].min) return i
  return 0
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)
const centsToUsd = (c: number) => formatCurrency(c / 100)
const formatAum = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n)}`
}

// ─── Animated count-up (1.2s ease-out cubic) ────────────────────────────────

function useCountUp(target: string, duration: number = 1200) {
  const [display, setDisplay] = useState(target)
  const lastTarget = useRef<string>('')

  useEffect(() => {
    if (lastTarget.current === target) return
    lastTarget.current = target
    const numericStr = target.replace(/[^0-9.-]/g, '')
    const numericVal = parseFloat(numericStr) || 0
    if (numericVal === 0) { setDisplay(target); return }

    const isInteger = !target.includes('.') && !/\$/.test(target.split('.')[0])
    const isAum = /[KM]$/.test(target)
    const start = performance.now()

    let raf = 0
    const animate = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = numericVal * eased
      if (isAum) {
        setDisplay(formatAum(current))
      } else if (isInteger && !target.startsWith('$')) {
        setDisplay(`${Math.round(current)}`)
      } else {
        setDisplay(formatCurrency(current))
      }
      if (progress < 1) raf = requestAnimationFrame(animate)
      else setDisplay(target)
    }
    raf = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return display
}

// ─── Inline SVG icons not in Icons.tsx ──────────────────────────────────────

const SVG = ({ children, size = 16 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)
const IconCircle  = ({ size = 16 }: { size?: number }) => <SVG size={size}><circle cx="12" cy="12" r="9" /></SVG>
const IconTrophy  = ({ size = 16 }: { size?: number }) => <SVG size={size}><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" /><path d="M5 4H2v3a3 3 0 0 0 3 3M19 4h3v3a3 3 0 0 1-3 3" /></SVG>
const IconGem     = ({ size = 16 }: { size?: number }) => <SVG size={size}><path d="M6 3h12l4 6-10 12L2 9l4-6Z" /><path d="M6 3l4 6h4l4-6M2 9h20M12 21l-2-12M12 21l2-12" /></SVG>
const IconCrown   = ({ size = 16 }: { size?: number }) => <SVG size={size}><path d="M3 6l4 4 5-6 5 6 4-4-2 12H5L3 6Z" /></SVG>
const IconWallet  = ({ size = 16 }: { size?: number }) => <SVG size={size}><path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path d="M3 7V5a2 2 0 0 1 2-2h12v4M17 14h.01M21 11h-4a2 2 0 0 0 0 4h4" /></SVG>
const IconClock   = ({ size = 16 }: { size?: number }) => <SVG size={size}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></SVG>
const IconCopy    = ({ size = 16 }: { size?: number }) => <SVG size={size}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></SVG>
const IconCheck   = ({ size = 16 }: { size?: number }) => <SVG size={size}><path d="m5 12 5 5L20 7" /></SVG>
const IconUsers   = ({ size = 16 }: { size?: number }) => <SVG size={size}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></SVG>
const IconDollar  = ({ size = 16 }: { size?: number }) => <SVG size={size}><path d="M12 2v20M17 6H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H7" /></SVG>
const IconTrend   = ({ size = 16 }: { size?: number }) => <SVG size={size}><path d="M3 17l6-6 4 4 8-8M14 7h7v7" /></SVG>
const IconChevR   = ({ size = 16 }: { size?: number }) => <SVG size={size}><path d="m9 6 6 6-6 6" /></SVG>

function TierIcon({ kind, size = 22 }: { kind: typeof TIERS[number]['icon']; size?: number }) {
  if (kind === 'circle') return <IconCircle size={size} />
  if (kind === 'shield') return <Icons.Shield size={size} />
  if (kind === 'star')   return <Icons.Star size={size} />
  if (kind === 'trophy') return <IconTrophy size={size} />
  return <IconGem size={size} />
}

// ─── Main component ─────────────────────────────────────────────────────────

export function BrokerContent() {
  const isPt = getCurrentLang() === 'PT'
  const tt = (en: string, pt: string) => (isPt ? pt : en)

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<BrokerData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [payoutAmount, setPayoutAmount] = useState('')
  const [payoutLoading, setPayoutLoading] = useState(false)
  const [payoutMsg, setPayoutMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [referralFilter, setReferralFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [ledgerOpen, setLedgerOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await authedFetch('/api/broker/dashboard')
        if (!r.ok) throw new Error(r.status === 403 ? 'not-broker' : `status ${r.status}`)
        const j = (await r.json()) as BrokerData
        if (!cancelled) setData(j)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'fetch-failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const splitPct = data?.broker.split_pct ?? 20
  const referralCode = data?.broker.referral_code || 'STAXS'
  const referralLink = `https://staxs.ai/?ref=${referralCode}`

  const handleCopy = useCallback(() => {
    if (!referralLink) return
    navigator.clipboard.writeText(referralLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [referralLink])

  const handleRequestPayout = async () => {
    const amt = Number(payoutAmount)
    if (!amt || amt < 20) {
      setPayoutMsg({ ok: false, text: tt('Minimum payout is $20', 'Pagamento mínimo: $20') })
      return
    }
    setPayoutLoading(true)
    setPayoutMsg(null)
    try {
      const r = await authedFetch('/api/broker/request-payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt }),
      })
      const j = await r.json().catch(() => ({} as any))
      if (r.ok) {
        setPayoutMsg({ ok: true, text: tt('Payout request submitted!', 'Solicitação enviada!') })
        setPayoutAmount('')
      } else {
        setPayoutMsg({ ok: false, text: j?.error || tt('Request failed', 'Falha na solicitação') })
      }
    } catch {
      setPayoutMsg({ ok: false, text: tt('Network error', 'Erro de rede') })
    } finally {
      setPayoutLoading(false)
    }
  }

  // ── Loading
  if (loading) {
    return (
      <div className="stax-page">
        <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--muted)' }}>
          {tt('Loading…', 'Carregando…')}
        </div>
      </div>
    )
  }

  // ── Empty / error (auto-approved system: API may still 403 for fresh accounts)
  if (error === 'not-broker' || !data) {
    return (
      <div className="stax-page">
        <div className="bt-header" style={{ marginBottom: 14 }}>
          <div className="bt-eyebrow">{tt('BROKER PROGRAM', 'PROGRAMA DE PARCEIROS')}</div>
          <h1 className="bt-title">
            {tt('Refer and ', 'Indique e ')}
            <span className="bt-title-gold">{tt('earn.', 'ganhe.')}</span>
          </h1>
          <p className="bt-blurb">
            {tt(
              'Share Staxs with your contacts and earn a share of every fee they pay. Auto-approved — no application needed.',
              'Compartilhe Staxs com seus contatos e ganhe parte de cada taxa que pagarem. Aprovação automática — não precisa pedir.'
            )}
          </p>
        </div>
        <div className="card card-pad" style={{ color: 'var(--muted)', fontSize: 12.5 }}>
          {tt(
            'Connect your Staxs account and your referral code will appear here.',
            'Conecte sua conta Staxs e seu código de indicação aparecerá aqui.'
          )}
        </div>
      </div>
    )
  }

  const s = data.summary
  const currentAum = s.total_capital
  const tierIndex = getTier(currentAum)
  const currentTier = TIERS[tierIndex]
  const nextTier = tierIndex < TIERS.length - 1 ? TIERS[tierIndex + 1] : null
  const progressPct = nextTier
    ? Math.min(((currentAum - currentTier.min) / (nextTier.min - currentTier.min)) * 100, 100)
    : 100

  const filteredUsers = data.users.filter(u => {
    if (referralFilter === 'active') return u.status === 'Active'
    if (referralFilter === 'inactive') return u.status !== 'Active'
    return true
  })
  const totals = filteredUsers.reduce(
    (acc, u) => ({
      pnl: acc.pnl + u.total_pnl_cents,
      fees: acc.fees + u.total_fees_cents,
      share: acc.share + u.broker_share_cents,
    }),
    { pnl: 0, fees: 0, share: 0 }
  )

  return (
    <div className="stax-page">

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <div className="bt-header" style={{ marginBottom: 14 }}>
        <div className="bt-eyebrow">{tt('BROKER PROGRAM', 'PROGRAMA DE PARCEIROS')}</div>
        <h1 className="bt-title">
          {tt('Earn when your referrals ', 'Ganhe quando seus indicados ')}
          <span className="bt-title-gold">{tt('profit.', 'lucram.')}</span>
        </h1>
        <p className="bt-blurb">
          {tt(
            'Your referrals pay nothing upfront — Staxs charges a 20% performance fee only on net profits. You earn a share of that fee based on the total AUM you bring. The more your referrals deposit and grow, the higher your commission tier — and the more you earn.',
            'Seus indicados não pagam nada antecipadamente — a Staxs cobra apenas 20% sobre o lucro líquido. Você ganha uma fatia dessa taxa de acordo com o AUM total trazido. Quanto mais depositam e crescem, maior seu tier de comissão — e mais você ganha.'
          )}
        </p>
      </div>

      {/* ── Referral link card ─────────────────────────────────────── */}
      <div className="card card-pad">
        <div className="bt-card-head">
          <div className="bt-card-title"><span className="bt-card-bar" />{tt('YOUR REFERRAL LINK', 'SEU LINK DE INDICAÇÃO')}</div>
        </div>
        <div className="broker-link-row">
          <input
            type="text"
            value={referralLink}
            readOnly
            className="settings-input"
            style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12, flex: 1 }}
          />
          <button onClick={handleCopy} className="settings-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {copied ? <><IconCheck size={14} /> {tt('Copied!', 'Copiado!')}</> : <><IconCopy size={14} /> {tt('Copy', 'Copiar')}</>}
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
          {tt('Code', 'Código')}: <code style={{ color: 'var(--gold)', fontWeight: 700 }}>{referralCode}</code>
          {' · '}
          {tt('Current split', 'Divisão atual')}: <strong style={{ color: 'var(--text)' }}>{splitPct}%</strong>
        </div>
      </div>

      {/* ── 6 stat cards ───────────────────────────────────────────── */}
      <div className="row row-stats">
        <BrokerStat label={tt('Total Earnings', 'Ganhos Totais')} icon={<IconDollar size={14} />} value={centsToUsd(s.total_earnings_cents)} />
        <BrokerStat label={tt('Pending Payout', 'A Receber')}    icon={<IconClock size={14} />} value={centsToUsd(s.pending_cents)} valueClass="pos-text" />
        <BrokerStat label={tt('Paid Out', 'Pago')}                icon={<IconWallet size={14} />} value={centsToUsd(s.paid_cents)} />
        <BrokerStat label={tt('Active Referrals', 'Indicações Ativas')} icon={<IconUsers size={14} />} value={String(s.active_users)} sub={`${tt('of', 'de')} ${s.total_users} ${tt('total', 'total')}`} />
        <BrokerStat label={tt('Current AUM', 'AUM Atual')}        icon={<IconTrend size={14} />} value={formatAum(currentAum)} valueClass="" sub={`${tt('Across', 'Em')} ${s.active_users} ${tt('active', 'ativos')}`} gold />
        <BrokerStat label={tt('Current Tier', 'Tier Atual')}      icon={<IconCrown size={14} />} value={currentTier.name} sub={`${currentTier.pct}% ${tt('commission rate', 'taxa de comissão')}`} animate={false} />
      </div>

      {/* ── Commission tiers ladder ────────────────────────────────── */}
      <div className="card card-pad">
        <div className="bt-card-head">
          <div className="bt-card-title"><span className="bt-card-bar" />{tt('COMMISSION TIERS', 'TIERS DE COMISSÃO')}</div>
        </div>

        <div className="broker-tier-grid">
          {TIERS.map((t, i) => {
            const isActive = i === tierIndex
            const isLocked = i > tierIndex
            return (
              <div key={t.name} className={'broker-tier-card' + (isActive ? ' active' : '') + (isLocked ? ' locked' : '')}>
                {isActive && <span className="tier-current-pill">{tt('Your Tier', 'Seu Tier')}</span>}
                <div className="tier-ico"><TierIcon kind={t.icon} size={26} /></div>
                <div className="tier-name">{t.name}</div>
                <div className="tier-range">{t.range}</div>
                <div className="tier-pct">{t.pct}%</div>
                <div className="tier-pct-label">{tt('Commission', 'Comissão')}</div>
              </div>
            )
          })}
        </div>

        {/* AUM progress strip */}
        <div className="broker-aum-strip" style={{ marginTop: 14 }}>
          <div className="aum-meta">
            <strong>{currentTier.name}</strong>
            <span>{tt('current tier', 'tier atual')}</span>
          </div>
          <div className="aum-bar-wrap">
            <div className="aum-bar-fill" style={{ width: `${progressPct}%` }} />
          </div>
          {nextTier ? (
            <div className="aum-meta" style={{ justifyContent: 'flex-end' }}>
              <strong>{formatAum(currentAum)}</strong>
              <span>→</span>
              <span className="aum-next">{nextTier.name} · {nextTier.pct}%</span>
              <span>({formatAum(nextTier.min)})</span>
            </div>
          ) : (
            <div className="aum-meta" style={{ color: 'var(--gold)' }}>
              <strong>{tt('Top tier reached', 'Tier máximo')}</strong>
            </div>
          )}
        </div>
      </div>

      {/* ── Past Payouts + Request Payout (twin row) ──────────────── */}
      <div className="bt-twin-row">
        <div className="card card-pad">
          <div className="bt-card-head">
            <div className="bt-card-title"><span className="bt-card-bar" />{tt('PAST PAYOUTS', 'PAGAMENTOS ANTERIORES')}</div>
          </div>
          {data.payouts.length === 0 ? (
            <div className="broker-past-empty">
              <div className="ico"><IconWallet size={28} /></div>
              <div className="ttl">{tt('No payouts yet', 'Nenhum pagamento ainda')}</div>
              <div className="sub">{tt('Your payout history will appear here', 'Seu histórico aparecerá aqui')}</div>
            </div>
          ) : (
            <div>
              {data.payouts.slice(0, 5).map((p, i) => (
                <div key={i} className="broker-past-row">
                  <span style={{ color: 'var(--muted)' }}>{new Date(p.created_at).toLocaleDateString()}</span>
                  <span className="num" style={{ fontWeight: 600 }}>{centsToUsd(p.payout_amount_cents ?? p.amount_cents ?? 0)}</span>
                  <span className={'badge ' + (p.status === 'paid' ? 'badge-long' : 'badge-short')}>{p.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card card-pad">
          <div className="bt-card-head">
            <div className="bt-card-title"><span className="bt-card-bar" />{tt('REQUEST PAYOUT', 'SOLICITAR PAGAMENTO')}</div>
          </div>
          <div className="broker-payout-body">
            <div className="row-line">
              <span className="lbl">{tt('Total earned', 'Total ganho')}</span>
              <span className="val">{centsToUsd(s.total_earnings_cents)}</span>
            </div>
            <div className="row-line">
              <span className="lbl">{tt('Total paid out', 'Total pago')}</span>
              <span className="val gold">{centsToUsd(s.paid_cents)}</span>
            </div>
            <div className="row-line">
              <span className="lbl">{tt('Last payout', 'Último pagamento')}</span>
              <span className="val">{s.last_payout_date ? new Date(s.last_payout_date).toLocaleDateString() : tt('None yet', 'Nenhum')}</span>
            </div>
            <hr className="broker-payout-divider" />
            <div style={{ fontSize: 9.5, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>
              {tt('Pending Commissions', 'Comissões Pendentes')}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              {s.pending_cents > 0
                ? tt(`You have ${centsToUsd(s.pending_cents)} available for payout.`, `Você tem ${centsToUsd(s.pending_cents)} disponível.`)
                : tt('No pending commissions', 'Sem comissões pendentes')}
            </div>
            <div className="broker-payout-input-row">
              <input
                type="number"
                min={20}
                placeholder={tt('Amount', 'Valor')}
                value={payoutAmount}
                onChange={(e) => setPayoutAmount(e.target.value)}
                className="settings-input"
                style={{ flex: 1 }}
              />
              <button
                onClick={handleRequestPayout}
                disabled={payoutLoading}
                className="settings-btn-primary"
              >
                {payoutLoading ? tt('Submitting…', 'Enviando…') : tt('Request', 'Solicitar')}
              </button>
            </div>
            {payoutMsg && (
              <div className={payoutMsg.ok ? 'broker-payout-msg-pos' : 'broker-payout-msg-neg'}>{payoutMsg.text}</div>
            )}
            <div style={{ fontSize: 10.5, color: 'var(--muted-2)', lineHeight: 1.55 }}>
              {tt(
                'Commission rate applied to each payout is the tier active at the time the profit was generated — not the tier at payout date.',
                'A taxa de comissão aplicada é a do tier ativo quando o lucro foi gerado — não a do dia do pagamento.'
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Referral Performance ──────────────────────────────────── */}
      <div className="card card-pad">
        <div className="bt-card-head">
          <div className="bt-card-title"><span className="bt-card-bar" />{tt('REFERRAL PERFORMANCE', 'DESEMPENHO DAS INDICAÇÕES')}</div>
          <div className="bt-tier-pills">
            {(['all', 'active', 'inactive'] as const).map(f => (
              <button
                key={f}
                type="button"
                className={'bt-tier-pill' + (referralFilter === f ? ' active' : '')}
                onClick={() => setReferralFilter(f)}
              >
                {f === 'all' ? tt('All', 'Todos') : f === 'active' ? tt('Active', 'Ativos') : tt('Inactive', 'Inativos')}
              </button>
            ))}
          </div>
        </div>

        <div className="broker-perf-grid broker-perf-head">
          <span>{tt('Name', 'Nome')}</span>
          <span>{tt('Status', 'Status')}</span>
          <span className="hide-md">{tt('Joined', 'Entrou')}</span>
          <span className="ta-r">AUM</span>
          <span className="ta-r hide-md">{tt('Fees Generated', 'Taxas Geradas')}</span>
          <span className="ta-r">{tt('Your Share', 'Sua Parte')}</span>
        </div>

        {filteredUsers.length === 0 ? (
          <div className="broker-perf-empty">
            {data.users.length === 0
              ? tt('No referrals yet. Share your link to get started!', 'Sem indicações ainda. Compartilhe seu link!')
              : tt('No referrals in this filter.', 'Nenhuma indicação neste filtro.')}
          </div>
        ) : (
          <>
            {filteredUsers.map((u, i) => (
              <div key={i} className="broker-perf-grid broker-perf-row">
                <span style={{ color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.name || u.email}
                </span>
                <span>
                  <span className={'badge ' + (u.status === 'Active' ? 'badge-long' : 'badge-short')}>
                    {u.status === 'Active' ? tt('Active', 'Ativo') : tt('Inactive', 'Inativo')}
                  </span>
                </span>
                <span className="hide-md" style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                  {u.joined ? new Date(u.joined).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                </span>
                <span className="num ta-r">{centsToUsd(u.total_pnl_cents)}</span>
                <span className="num ta-r hide-md">{centsToUsd(u.total_fees_cents)}</span>
                <span className="num ta-r" style={{ color: 'var(--gold)', fontWeight: 600 }}>{centsToUsd(u.broker_share_cents)}</span>
              </div>
            ))}
            <div className="broker-perf-grid broker-perf-row totals">
              <span>{tt('Total', 'Total')}</span>
              <span />
              <span className="hide-md" />
              <span className="num ta-r">{centsToUsd(totals.pnl)}</span>
              <span className="num ta-r hide-md">{centsToUsd(totals.fees)}</span>
              <span className="num ta-r" style={{ color: 'var(--gold)' }}>{centsToUsd(totals.share)}</span>
            </div>
          </>
        )}
      </div>

      {/* ── How You Earn (3-step) ─────────────────────────────────── */}
      <div className="card card-pad">
        <div className="bt-card-head">
          <div className="bt-card-title"><span className="bt-card-bar" />{tt('HOW YOU EARN', 'COMO VOCÊ GANHA')}</div>
        </div>
        <div className="broker-steps">
          <StepCard
            n={1}
            tag={tt('Step 1', 'Passo 1')}
            ico={<IconUsers size={20} />}
            title={tt('Refer traders to Staxs', 'Indique traders para a Staxs')}
            desc={tt(
              'Share your unique referral link. They sign up and connect their Bitget or Binance account. Zero upfront cost for them.',
              'Compartilhe seu link. Eles se cadastram e conectam Bitget ou Binance. Zero custo inicial.'
            )}
          />
          <StepCard
            n={2}
            tag={tt('Step 2', 'Passo 2')}
            ico={<IconTrend size={20} />}
            title={tt('They profit → you earn', 'Eles lucram → você ganha')}
            desc={tt(
              `Staxs charges 20% of net profits only. You earn ${splitPct}–50% of that fee depending on your AUM tier. No profit = no fee = no cost to anyone.`,
              `A Staxs cobra apenas 20% sobre o lucro líquido. Você ganha de ${splitPct}–50% dessa taxa conforme seu tier de AUM. Sem lucro = sem taxa = zero custo.`
            )}
          />
          <StepCard
            n={3}
            tag={tt('Step 3', 'Passo 3')}
            ico={<IconCrown size={20} />}
            title={tt('Grow AUM → unlock higher tiers', 'Aumente o AUM → libere tiers')}
            desc={tt(
              'The more your referrals deposit and grow, the higher your AUM. Higher AUM = higher tier = higher commission. Up to 50% at Elite tier ($100K+ AUM).',
              'Quanto mais depositam e crescem, maior seu AUM. AUM maior = tier maior = comissão maior. Até 50% no Elite ($100K+).'
            )}
          />
        </div>
      </div>

      {/* ── Tier Summary table ────────────────────────────────────── */}
      <div className="card card-pad">
        <div className="bt-card-head">
          <div className="bt-card-title"><span className="bt-card-bar" />{tt('TIER SUMMARY', 'RESUMO DOS TIERS')}</div>
        </div>
        <div className="table-scroll">
          <table className="bt-stat-table">
            <thead>
              <tr>
                <th>{tt('Tier', 'Tier')}</th>
                <th>{tt('AUM Required', 'AUM Necessário')}</th>
                <th style={{ textAlign: 'right' }}>{tt('Your Commission', 'Sua Comissão')}</th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map((t, i) => {
                const isActive = i === tierIndex
                return (
                  <tr key={t.name} className={isActive ? 'active-tier' : ''}>
                    <td style={{ color: 'var(--text)', fontWeight: 600 }}>
                      {t.name}
                      {isActive && <span className="badge badge-long" style={{ marginLeft: 8 }}>{tt('CURRENT', 'ATUAL')}</span>}
                    </td>
                    <td>
                      {t.max === Infinity
                        ? `$${(t.min / 1000).toFixed(0)}K+`
                        : `$${t.min === 0 ? '0' : (t.min / 1000).toFixed(0) + 'K'} → $${(t.max / 1000).toFixed(0)}K`}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: isActive ? 'var(--gold)' : 'var(--text)' }}>
                      {t.pct}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Payout Ledger (collapsible) ───────────────────────────── */}
      <div className="card card-pad">
        <button
          className="broker-collapsible-head"
          aria-expanded={ledgerOpen}
          onClick={() => setLedgerOpen(o => !o)}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className="chev"><IconChevR size={14} /></span>
            {tt('PAYOUT LEDGER', 'LIVRO DE PAGAMENTOS')}
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{data.payouts.length} {tt('entries', 'registros')}</span>
        </button>
        {ledgerOpen && (
          <div style={{ marginTop: 12 }}>
            {data.payouts.length === 0 ? (
              <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>
                {tt('No payout records yet.', 'Nenhum registro ainda.')}
              </div>
            ) : (
              <>
                <div className="broker-ledger-grid head">
                  <span>{tt('Date', 'Data')}</span>
                  <span>{tt('User', 'Usuário')}</span>
                  <span className="hide-md">{tt('Method', 'Método')}</span>
                  <span style={{ textAlign: 'right' }}>{tt('Amount', 'Valor')}</span>
                  <span style={{ textAlign: 'right' }}>{tt('Status', 'Status')}</span>
                </div>
                {data.payouts.map((p, i) => (
                  <div key={i} className="broker-ledger-grid">
                    <span style={{ color: 'var(--muted)' }}>{new Date(p.created_at).toLocaleDateString()}</span>
                    <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.user_name || p.user_email || '—'}
                    </span>
                    <span className="hide-md" style={{ color: 'var(--muted)' }}>{p.method || 'USDT'}</span>
                    <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>
                      {centsToUsd(p.payout_amount_cents ?? p.amount_cents ?? 0)}
                    </span>
                    <span style={{ textAlign: 'right' }}>
                      <span className={'badge ' + (p.status === 'paid' ? 'badge-long' : 'badge-short')}>{p.status}</span>
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Stat card with count-up ────────────────────────────────────────────────

function BrokerStat({
  label,
  icon,
  value,
  sub,
  valueClass,
  gold,
  animate = true,
}: {
  label: string
  icon: React.ReactNode
  value: string
  sub?: string
  valueClass?: string
  gold?: boolean
  animate?: boolean
}) {
  const animated = useCountUp(animate ? value : '')
  const display = animate ? (animated || value) : value
  return (
    <div className="card stat-card">
      <div className="stat-head">
        <div className="stat-ico">{icon}</div>
        <div className="label">{label}</div>
      </div>
      <div className={'stat-val num' + (valueClass ? ' ' + valueClass : '')} style={gold ? { color: 'var(--gold)' } : undefined}>
        {display}
      </div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  )
}

// ─── Step card ──────────────────────────────────────────────────────────────

function StepCard({
  n, tag, ico, title, desc,
}: { n: number; tag: string; ico: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="broker-step-card">
      <div className="step-num">{n}</div>
      <div className="step-ico">{ico}</div>
      <div className="step-tag">{tag}</div>
      <div className="step-title">{title}</div>
      <div className="step-desc">{desc}</div>
    </div>
  )
}
