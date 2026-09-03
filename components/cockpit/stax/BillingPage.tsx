'use client'

/**
 * Billing — the customer's invoices, IN THE APP.
 *
 * ── 2026-09-03 ────────────────────────────────────────────────────────────────────────────────
 * Chris: "this is not how an invoice was sent to the user... It can still send the email, BUT THE
 * INVOICE ITSELF SHOULD BE IN THE APP."
 *
 * Checked git history first, as asked. What already existed: the customer API
 * (/api/billing/invoices, and /api/billing/invoices/[id]/pay-crypto for declaring payment), the
 * invoice email, and the admin table. What has NEVER been committed, in either repository, is a
 * customer-facing billing PAGE — the only invoice page in the whole history is the admin one. So
 * the back half was built and the front half never was; it was not lost in the UI migration.
 *
 * This is that page, built on the API that was already there. The email is a notification; this
 * is the invoice.
 */

import { useCallback, useEffect, useState } from 'react'
import { authedFetch } from '@/lib/api'

type Invoice = {
  id: string
  amount_cents: number
  currency: string
  description: string | null
  status: 'draft' | 'sent' | 'pending_verification' | 'paid' | 'overdue' | 'void'
  issued_at: string | null
  due_at: string | null
  paid_at: string | null
  crypto_coin: string | null
  crypto_network: string | null
  crypto_wallet_address: string | null
  crypto_tx_hash: string | null
}
type Wallet = { network: string; coin: string; wallet_address: string; label: string | null }

const usd = (cents: number) =>
  '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

/** Days until due — negative once overdue. */
function daysLeft(due: string | null): number | null {
  if (!due) return null
  return Math.round((Date.parse(due) - Date.now()) / 86400_000)
}

function StatusPill({ inv }: { inv: Invoice }) {
  const d = daysLeft(inv.due_at)
  const map: Record<string, { label: string; cls: string }> = {
    paid:    { label: 'Paid',    cls: 'badge-long' },
    sent:    { label: d != null && d < 0 ? 'Overdue' : 'Awaiting payment', cls: d != null && d < 0 ? 'badge-short' : '' },
    // Found by walking the journey: pressing "I've paid" moves the invoice to
    // pending_verification, and this map did not know that state — the customer would have been
    // shown a raw database word after the one action they take on this page.
    pending_verification: { label: 'Payment sent — confirming', cls: '' },
    overdue: { label: 'Overdue', cls: 'badge-short' },
    draft:   { label: 'Draft',   cls: '' },
    void:    { label: 'Void',    cls: '' },
  }
  const m = map[inv.status] || { label: inv.status, cls: '' }
  return <span className={'badge ' + m.cls}>{m.label}</span>
}

export function BillingContent() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await authedFetch<{ invoices: Invoice[]; wallets: Wallet[] }>('/api/billing/invoices')
      setInvoices(r.invoices || [])
      setWallets(r.wallets || [])
      setErr(null)
    } catch (e: any) {
      // Same lesson as the trades hook: a failed poll is an absence of news. Keep what we have.
      setErr(e?.message || 'Could not load your invoices')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const declarePaid = async (inv: Invoice) => {
    const w = wallets.find(x => x.network === inv.crypto_network) || wallets[0]
    if (!w) { setErr('No payment wallet is configured — please contact support.'); return }
    setBusy(inv.id)
    try {
      await authedFetch(`/api/billing/invoices/${inv.id}/pay-crypto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coin: w.coin, network: w.network }),
      })
      await load()
    } catch (e: any) {
      setErr(e?.message || 'Could not record your payment')
    } finally { setBusy(null) }
  }

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id); setTimeout(() => setCopied(null), 1800)
    }).catch(() => {})
  }

  // pending_verification counts as outstanding: the customer has SAID they paid, but until it is
  // confirmed the money is still owed. Showing "nothing outstanding" the moment they press the
  // button would tell them the account is settled when it is not.
  const outstanding = (invoices || []).filter(
    i => i.status === 'sent' || i.status === 'overdue' || i.status === 'pending_verification')
  const totalDue = outstanding.reduce((a, i) => a + i.amount_cents, 0)

  return (
    <div className="stax-page">
      <div className="page-head">
        <div>
          <h1>Billing</h1>
          <p className="sub">
            Staxs charges 20% of the profit you make in each period. Nothing is charged on a losing
            period, and there is no high-water mark — every period stands on its own.
          </p>
        </div>
      </div>

      {err && <div className="card" style={{ borderColor: 'var(--neg)' }}><p className="neg-text">{err}</p></div>}

      <div className="card">
        <div className="label">AMOUNT DUE</div>
        <div className="big-value">{usd(totalDue)}</div>
        <div className="sub">
          {outstanding.length === 0
            ? 'Nothing outstanding.'
            : outstanding.every(i => i.status === 'pending_verification')
              ? `${outstanding.length} invoice${outstanding.length === 1 ? '' : 's'} awaiting our confirmation`
              : `${outstanding.length} invoice${outstanding.length === 1 ? '' : 's'} awaiting payment`}
        </div>
      </div>

      <div className="card">
        <div className="label">YOUR INVOICES</div>
        {invoices === null ? (
          <p className="sub">Loading…</p>
        ) : invoices.length === 0 ? (
          <p className="sub">
            No invoices yet. One is raised at the end of any period in which the bot made a profit.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Period</th><th>Status</th><th className="num">Amount</th>
                  <th>Due</th><th>Pay to</th><th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => {
                  const d = daysLeft(inv.due_at)
                  return (
                    <tr key={inv.id}>
                      <td>
                        <div>{inv.description || 'Performance fee'}</div>
                        <div className="ts">Issued {day(inv.issued_at)}</div>
                      </td>
                      <td><StatusPill inv={inv} /></td>
                      <td className="num">{usd(inv.amount_cents)}</td>
                      <td>
                        <div>{day(inv.due_at)}</div>
                        {inv.status !== 'paid' && d != null && (
                          <div className={'ts ' + (d < 0 ? 'neg-text' : '')}>
                            {d < 0 ? `${Math.abs(d)}d overdue` : `${d}d left`}
                          </div>
                        )}
                      </td>
                      <td>
                        {inv.status === 'pending_verification' ? (
                          <span className="sub">We are confirming your transfer.</span>
                        ) : inv.status === 'paid' ? (
                          <span className="sub">Paid {day(inv.paid_at)}</span>
                        ) : inv.crypto_wallet_address ? (
                          <div>
                            <div className="ts">{inv.crypto_coin} · {inv.crypto_network}</div>
                            <button className="link-btn" onClick={() => copy(inv.crypto_wallet_address!, inv.id)}
                                    title={inv.crypto_wallet_address}>
                              {copied === inv.id ? 'Copied' : `${inv.crypto_wallet_address.slice(0, 10)}…  copy`}
                            </button>
                          </div>
                        ) : <span className="sub">—</span>}
                      </td>
                      <td className="num">
                        {inv.status !== 'paid' && inv.status !== 'void' && inv.status !== 'pending_verification' && (
                          <button className="btn" disabled={busy === inv.id} onClick={() => declarePaid(inv)}>
                            {busy === inv.id ? 'Saving…' : "I've paid"}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {wallets.length > 0 && (
        <div className="card">
          <div className="label">WHERE TO SEND PAYMENT</div>
          <p className="sub">Pay in USDT or USDC on any of these networks. Send the exact amount shown on the invoice.</p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Network</th><th>Coin</th><th>Address</th><th></th></tr></thead>
              <tbody>
                {wallets.map(w => (
                  <tr key={w.network}>
                    <td>{w.label || w.network}</td>
                    <td>{w.coin === 'ALL' ? 'USDT / USDC' : w.coin}</td>
                    <td className="mono" style={{ wordBreak: 'break-all' }}>{w.wallet_address}</td>
                    <td className="num">
                      <button className="link-btn" onClick={() => copy(w.wallet_address, w.network)}>
                        {copied === w.network ? 'Copied' : 'Copy'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sub" style={{ marginTop: 10 }}>
            Once you have sent it, press <strong>I&apos;ve paid</strong> on the invoice. We confirm the
            transfer and mark it settled — your bot keeps trading throughout.
          </p>
        </div>
      )}
    </div>
  )
}
