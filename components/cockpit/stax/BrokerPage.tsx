'use client'

/**
 * Broker page — affiliate dashboard. Reads /api/broker/dashboard which
 * returns broker profile + per-referral breakdown + payout ledger.
 *
 * Auto-approved broker model: every user has a referral code; this page
 * shows their performance regardless of formal "approved" status. Fall
 * back to a friendly empty state if the API gates them out.
 */

import { useEffect, useState } from 'react'
import { useT, getCurrentLang } from '@/lib/i18n'
import { authedFetch } from '@/lib/api'

type BrokerData = {
  broker: { name: string; split_pct: number; status: string; referral_code: string | null }
  summary: {
    total_users: number
    active_users: number
    total_capital: number
    total_earnings_cents: number
    pending_cents: number
    paid_cents: number
  }
  users: Array<{
    email: string
    name: string
    plan: string
    status: string
    total_pnl_cents: number
    broker_share_cents: number
    joined: string
  }>
}

export function BrokerContent() {
  const t = useT()
  const [data, setData] = useState<BrokerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await authedFetch('/api/broker/dashboard')
        if (!r.ok) throw new Error(r.status === 403 ? 'not-broker' : `status ${r.status}`)
        const j = await r.json()
        if (!cancelled) setData(j)
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'fetch failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const code = data?.broker?.referral_code || ''
  const link = code ? `https://staxs.ai/?ref=${code}` : ''

  function copyLink() {
    if (!link) return
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const isPt = getCurrentLang() === 'PT'

  if (loading) {
    return <div className="stax-page"><div className="card card-pad bt-card">{t('common.loading')}</div></div>
  }

  // API may 403 for users not yet flagged as broker — show friendly empty state
  if (error === 'not-broker' || !data) {
    return (
      <div className="stax-page">
        <div className="bt-header">
          <div className="bt-eyebrow">{t('broker.title').toUpperCase()}</div>
          <h1 className="bt-title">{isPt ? 'Indique e' : 'Refer and'} <span className="bt-title-gold">{isPt ? 'ganhe.' : 'earn.'}</span></h1>
          <p className="bt-blurb">
            {isPt
              ? 'Compartilhe Staxs com seus contatos e ganhe 25% das taxas que eles pagarem. Aprovação automática — não precisa pedir.'
              : 'Share Staxs with your contacts and earn 25% of every fee they pay. Auto-approved — no application needed.'}
          </p>
        </div>
        <div className="card card-pad bt-card">
          <div className="settings-help">{isPt ? 'Conecte sua conta Staxs e seu código de indicação aparecerá aqui.' : 'Connect your Staxs account and your referral code will appear here.'}</div>
        </div>
      </div>
    )
  }

  const summary = data.summary

  return (
    <div className="stax-page">
      {/* Header */}
      <div className="bt-header">
        <div className="bt-eyebrow">{isPt ? 'PROGRAMA DE PARCEIROS' : 'BROKER PROGRAM'}</div>
        <h1 className="bt-title">
          {isPt ? <>Indique e <span className="bt-title-gold">ganhe.</span></> : <>Refer and <span className="bt-title-gold">earn.</span></>}
        </h1>
        <p className="bt-blurb">
          {isPt
            ? `Compartilhe Staxs e ganhe ${data.broker.split_pct}% das taxas que seus indicados pagarem. Pago mensalmente em BTC ou USDT.`
            : `Share Staxs and earn ${data.broker.split_pct}% of every fee your referrals pay. Paid monthly in BTC or USDT.`}
        </p>
      </div>

      {/* Referral link */}
      <div className="card card-pad bt-card">
        <div className="bt-card-title">{t('broker.referralLink')}</div>
        <div className="broker-link-row">
          <input type="text" value={link} readOnly className="settings-input" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }} />
          <button onClick={copyLink} className="settings-btn-primary">
            {copied ? t('broker.copied') : t('broker.copy')}
          </button>
        </div>
        <div className="settings-help" style={{ marginTop: 8 }}>
          {t('broker.referralCode')}: <code style={{ color: 'var(--gold)', fontWeight: 700 }}>{code || '—'}</code> · {t('broker.split')}: <strong>{data.broker.split_pct}%</strong>
        </div>
      </div>

      {/* Summary */}
      <div className="bt-metrics-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <MetricCard label={t('broker.totalEarnings')} value={`$${(summary.total_earnings_cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} positive />
        <MetricCard label={t('broker.pending')} value={`$${(summary.pending_cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
        <MetricCard label={t('broker.referrals')} value={String(summary.total_users)} sub={`${summary.active_users} ${isPt ? 'ativos' : 'active'}`} />
        <MetricCard label={isPt ? 'Capital sob gestão' : 'Capital managed'} value={`$${(summary.total_capital).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
      </div>

      {/* Claim button */}
      <div className="card card-pad bt-card">
        <div className="broker-claim-row">
          <div>
            <div className="bt-card-title" style={{ marginBottom: 4 }}>{t('broker.claim')}</div>
            <div className="settings-help">{t('broker.minClaim')}</div>
          </div>
          <button
            disabled={summary.pending_cents < 2000}
            className="settings-btn-primary"
            onClick={() => {
              authedFetch('/api/broker/request-payout', { method: 'POST' })
                .then(() => alert(isPt ? 'Pagamento solicitado.' : 'Payout requested.'))
                .catch(() => alert(t('common.error')))
            }}
          >
            {t('broker.claim')} (${(summary.pending_cents / 100).toFixed(2)})
          </button>
        </div>
      </div>

      {/* Referrals list */}
      <div className="card card-pad bt-card">
        <div className="bt-card-title">{t('broker.referralsList')}</div>
        {data.users.length === 0 ? (
          <div className="settings-help">{t('broker.empty')}</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{isPt ? 'Nome' : 'Name'}</th>
                  <th>{isPt ? 'Plano' : 'Plan'}</th>
                  <th>{isPt ? 'Status' : 'Status'}</th>
                  <th>P&amp;L</th>
                  <th>{isPt ? 'Sua comissão' : 'Your commission'}</th>
                  <th>{isPt ? 'Entrou' : 'Joined'}</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u, i) => (
                  <tr key={i}>
                    <td className="num">{u.name}</td>
                    <td className="num">{u.plan}</td>
                    <td>
                      <span className={'badge ' + (u.status === 'Active' ? 'badge-long' : 'badge-short')}>
                        {u.status}
                      </span>
                    </td>
                    <td className={'num ' + (u.total_pnl_cents > 0 ? 'pos-text' : u.total_pnl_cents < 0 ? 'neg-text' : '')}>
                      {u.total_pnl_cents >= 0 ? '+' : ''}${(u.total_pnl_cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className={'num pos-text'}>
                      ${(u.broker_share_cents / 100).toFixed(2)}
                    </td>
                    <td className="num" style={{ color: 'var(--muted)' }}>
                      {new Date(u.joined).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function MetricCard({ label, value, sub, positive, negative }: { label: string; value: string; sub?: string; positive?: boolean; negative?: boolean }) {
  const cls = positive ? 'pos-text' : negative ? 'neg-text' : ''
  return (
    <div className="bt-metric">
      <div className="bt-metric-label">{label}</div>
      <div className={'bt-metric-value num ' + cls}>{value}</div>
      {sub ? <div className="bt-metric-sub">{sub}</div> : null}
    </div>
  )
}
