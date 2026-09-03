'use client'

/**
 * Invoice + payment — a port of the pre-migration client-dashboard (public/client-dashboard.html,
 * window._loadInvoices), not a redesign.
 *
 * Chris: "if you check the original version, it was a step by step on how to pay the bloody
 * invoice. Here, there is nothing. no button, nothing... huge number on bold, nothing like what
 * was designed originally."
 *
 * He is right. My first attempt was a flat row with a dropdown. The original walks the customer
 * through it: choose a network (with the wrong-network warning), send THIS exact amount (the
 * unique cent amount, so payment can be matched automatically), to THIS address, then confirm —
 * and offers the card as a clearly separate fallback below an OR divider. Same steps, same
 * wording, same order here; the styling uses the app's own tokens rather than the old page's.
 */

import { useEffect, useMemo, useState } from 'react'
import { authedFetch } from '@/lib/api'

export type Invoice = {
  id: string
  amount_cents: number
  unique_amount_cents?: number | null
  description: string | null
  status: string
  due_at: string | null
  paid_at: string | null
  payment_method?: string | null
  crypto_coin?: string | null
  crypto_network?: string | null
}
type Wallet = { network: string; coin: string; wallet_address: string; label: string | null }
type Card = { brand?: string; last4?: string } | null

/** The networks the original offered, mapped onto the wallet groups we actually hold. */
const NETWORKS: Array<{ group: string; code: string; name: string; chain: string; time: string; popular?: boolean }> = [
  { group: 'EVM', code: 'BEP20', name: 'BEP-20', chain: 'Binance Smart Chain', time: '≈ 1 min', popular: true },
  { group: 'EVM', code: 'POLYGON', name: 'POL', chain: 'Polygon', time: '≈ 1 min' },
  { group: 'EVM', code: 'ARB', name: 'Arbitrum One', chain: 'Arbitrum', time: '≈ 2 min' },
  { group: 'EVM', code: 'OP', name: 'Optimism', chain: 'OP Mainnet', time: '≈ 2 min' },
  { group: 'EVM', code: 'BASE', name: 'Base', chain: 'Coinbase L2', time: '≈ 2 min' },
  { group: 'EVM', code: 'ERC20', name: 'ERC-20', chain: 'Ethereum Mainnet', time: '≈ 5 min' },
  { group: 'TRC20', code: 'TRC20', name: 'TRC-20', chain: 'Tron', time: '≈ 1 min' },
  { group: 'SOL', code: 'SOL', name: 'SOL', chain: 'Solana', time: '≈ 1 min' },
]

const STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'var(--muted)' },
  sent: { label: 'Awaiting Payment', tone: 'var(--gold, #D4A017)' },
  pending_verification: { label: 'Pending Verification', tone: '#f59e0b' },
  paid: { label: 'Paid ✓', tone: 'var(--pos, #22c55e)' },
  overdue: { label: 'Overdue', tone: '#ef4444' },
  failed: { label: 'Failed', tone: '#ef4444' },
  void: { label: 'Voided', tone: 'var(--muted)' },
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`

/** Human message out of authedFetch's raw "400 Bad Request: {json}". */
function humanError(e: any, fallback: string) {
  const raw = String(e?.message || '')
  const m = raw.match(/\{[\s\S]*\}$/)
  if (m) { try { const j = JSON.parse(m[0]); if (j?.error) return String(j.error) } catch {} }
  return raw && !/^\d{3}\b/.test(raw) ? raw : fallback
}

export function InvoicePayPanel({ onChange }: { onChange?: () => void }) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [card, setCard] = useState<Card>(null)
  const [netFor, setNetFor] = useState<Record<string, string>>({})
  const [openPicker, setOpenPicker] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ id: string; text: string; bad?: boolean } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const load = async () => {
    try {
      const j = await authedFetch<{ invoices: Invoice[]; wallets: Wallet[]; card: Card }>('/api/billing/invoices')
      setInvoices(j.invoices || []); setWallets(j.wallets || []); setCard(j.card || null)
    } catch { /* a failed poll is not "nothing is owed" */ }
  }
  useEffect(() => { load() }, [])

  const due = useMemo(
    () => invoices.filter(i => i.status !== 'paid' && i.status !== 'void' && i.status !== 'draft'),
    [invoices])

  if (!due.length) return null

  const walletFor = (code: string): Wallet | null => {
    const n = NETWORKS.find(x => x.code === code)
    if (!n) return null
    return wallets.find(w => w.network === n.group) || null
  }

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1500) }).catch(() => {})
  }

  const confirmCrypto = async (inv: Invoice) => {
    const code = netFor[inv.id]
    const w = code ? walletFor(code) : null
    if (!w) { setMsg({ id: inv.id, text: 'Choose a network first.', bad: true }); return }
    setBusy(inv.id); setMsg(null)
    try {
      await authedFetch(`/api/billing/invoices/${inv.id}/pay-crypto`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coin: w.coin, network: w.network }),
      })
      await load(); onChange?.()
    } catch (e: any) { setMsg({ id: inv.id, text: humanError(e, 'Something went wrong.'), bad: true }) }
    finally { setBusy(null) }
  }

  const chargeCard = async (inv: Invoice) => {
    setBusy(inv.id); setMsg(null)
    try {
      await authedFetch(`/api/billing/invoices/${inv.id}/charge-card`, { method: 'POST' })
      await load(); onChange?.()
    } catch (e: any) {
      setMsg({ id: inv.id, text: humanError(e, 'The card was declined. Try another card or pay by crypto.'), bad: true })
    } finally { setBusy(null) }
  }

  const LabelCap = ({ children }: { children: any }) => (
    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{children}</div>
  )

  return (
    <>
      {due.map(inv => {
        const payable = inv.status === 'sent' || inv.status === 'overdue'
        const st = STATUS[inv.status] || { label: inv.status, tone: 'var(--muted)' }
        const payAmt = inv.unique_amount_cents ? money(inv.unique_amount_cents) : money(inv.amount_cents)
        const dueLabel = inv.due_at
          ? new Date(inv.due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '—'
        const code = netFor[inv.id]
        const w = code ? walletFor(code) : null
        const chosen = NETWORKS.find(n => n.code === code)

        return (
          <div key={inv.id} className="card card-pad bp-card"
               style={payable ? { border: '1px solid rgba(239,68,68,0.3)', background: 'linear-gradient(135deg,rgba(239,68,68,0.04),transparent)' } : undefined}>
            {/* header — description + due date, amount + status */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{inv.description || 'Performance Fee'}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  {payable ? `Due by: ${dueLabel}` : dueLabel}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono, JetBrains Mono, monospace)' }}>{money(inv.amount_cents)}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 10, background: `color-mix(in srgb, ${st.tone} 13%, transparent)`, color: st.tone }}>{st.label}</span>
              </div>
            </div>

            {inv.status === 'pending_verification' && (
              <div style={{ marginTop: 10, padding: '12px 14px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, fontSize: 12, color: '#f59e0b' }}>
                <div style={{ fontWeight: 600 }}>Payment submitted</div>
                <div style={{ marginTop: 4, color: 'var(--muted)' }}>Your crypto payment is being verified. This usually takes a few hours.</div>
              </div>
            )}

            {payable && (
              <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                {/* ── PAY WITH CRYPTO ── */}
                <div style={{ marginBottom: 16, padding: 20, background: 'linear-gradient(135deg,rgba(212,160,23,0.06),rgba(212,160,23,0.02))', border: '1px solid rgba(212,160,23,0.2)', borderRadius: 12 }}>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>Pay with Crypto</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Preferred method · Instant confirmation</div>
                  </div>

                  <LabelCap>Coin</LabelCap>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', border: '1px solid var(--gold, #D4A017)', borderRadius: 10, background: 'rgba(212,160,23,0.06)', marginBottom: 14 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>USDT / USDC</span>
                  </div>

                  <LabelCap>Network</LabelCap>
                  <button type="button" onClick={() => setOpenPicker(openPicker === inv.id ? null : inv.id)}
                          style={{ width: '100%', textAlign: 'left', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', color: chosen ? 'var(--text)' : 'var(--muted)', fontSize: 13, cursor: 'pointer' }}>
                    {chosen ? `${chosen.name} · ${chosen.chain}` : 'Choose Network'}
                  </button>
                  {openPicker === inv.id && (
                    <div style={{ border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 10px 10px', background: 'var(--card)' }}>
                      <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>
                          Make sure the network you select <strong style={{ color: 'var(--text)' }}>matches your wallet</strong> — wrong network = permanent loss.
                        </span>
                      </div>
                      {NETWORKS.filter(n => wallets.some(x => x.network === n.group)).map(n => (
                        <div key={n.code} onClick={() => { setNetFor(m => ({ ...m, [inv.id]: n.code })); setOpenPicker(null) }}
                             style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', cursor: 'pointer', borderTop: '1px solid var(--border)' }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>
                              {n.name}{n.popular ? <span style={{ fontSize: 10, marginLeft: 6, padding: '1px 6px', borderRadius: 6, background: 'rgba(212,160,23,0.15)', color: 'var(--gold, #D4A017)' }}>Popular</span> : null}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{n.chain}</div>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{n.time}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ height: 14 }} />

                  <LabelCap>Send this exact amount</LabelCap>
                  <div style={{ textAlign: 'center', padding: 16, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16 }}>
                    <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--gold, #D4A017)', fontFamily: 'var(--font-mono, JetBrains Mono, monospace)', letterSpacing: 1 }}>{payAmt}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>⚠️ Amount must match exactly for automatic verification</div>
                    <button type="button" onClick={() => copy(payAmt.replace('$', ''), `amt-${inv.id}`)}
                            style={{ marginTop: 8, background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 16px', fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>
                      {copied === `amt-${inv.id}` ? 'Copied!' : 'Copy Amount'}
                    </button>
                  </div>

                  <LabelCap>To this wallet address</LabelCap>
                  <div style={{ padding: 14, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16, textAlign: 'center' }}>
                    {w ? (
                      <>
                        <div style={{ fontSize: 12, wordBreak: 'break-all', fontFamily: 'var(--font-mono, monospace)' }}>{w.wallet_address}</div>
                        <button type="button" onClick={() => copy(w.wallet_address, `addr-${inv.id}`)}
                                style={{ marginTop: 8, background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 16px', fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>
                          {copied === `addr-${inv.id}` ? 'Copied!' : 'Copy Address'}
                        </button>
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--muted)', padding: 8 }}>Select a network above to see the wallet address</div>
                    )}
                  </div>

                  <button type="button" disabled={busy === inv.id || !w} onClick={() => confirmCrypto(inv)}
                          style={{ width: '100%', background: w ? 'linear-gradient(135deg,#15803d,#22c55e)' : 'var(--card)', color: w ? '#fff' : 'var(--muted)', border: w ? 'none' : '1px solid var(--border)', borderRadius: 10, padding: 14, fontSize: 14, fontWeight: 700, cursor: w ? 'pointer' : 'not-allowed' }}>
                    {busy === inv.id ? 'Submitting…' : "✓ I've Sent the Payment"}
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>
                    After clicking, we&apos;ll verify the payment. If not received within 72 hours, your card on file will be charged automatically.
                  </div>
                </div>

                {/* ── OR ── */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>OR</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>

                {/* ── PAY WITH CARD ── */}
                {card ? (
                  <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>Pay with Card</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {(card.brand || 'Card').charAt(0).toUpperCase() + (card.brand || 'card').slice(1)} ending in {card.last4 || '****'}
                        </div>
                      </div>
                      <button type="button" disabled={busy === inv.id} onClick={() => chargeCard(inv)}
                              style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'var(--card)', color: 'var(--text)' }}>
                        {busy === inv.id ? 'Charging…' : `Charge ${money(inv.amount_cents)}`}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 10, textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      No card on file — add one in Payout Settings to enable the automatic fallback.
                    </div>
                  </div>
                )}

                {msg && msg.id === inv.id ? (
                  <div style={{ marginTop: 10, fontSize: 12, color: msg.bad ? '#ef4444' : 'var(--pos, #22c55e)' }}>{msg.text}</div>
                ) : null}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
