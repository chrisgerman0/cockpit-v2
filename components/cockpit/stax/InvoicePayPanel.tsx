'use client'

/**
 * Invoice + payment — the STEPPED flow, ported from the pre-migration dashboard's payout form
 * (public/obsidian-dashboard.html, #payoutCryptoForm), not a redesign.
 *
 * Chris, 2026-09-03: "the UI to pay the invoice, should be as the screenshots. Step 1, with check
 * mark, all nice. UI and UX is very important to me."
 *
 * The original is a numbered timeline: a gold connector line down the left, a numbered dot per
 * step, and one card per step — (1) the coin, fixed; (2) the recipient network, chosen from a
 * dropdown that carries its own wrong-network warning and per-chain fee/time; (3) the transfer
 * itself. A step that is satisfied swaps its number for a tick, so the customer can see how far
 * along they are without reading anything.
 *
 * Two deliberate differences from the source markup, both forced by what we actually hold:
 *   · the source is hard dark (#08080D, rgba(255,255,255,…)). The billing page renders in the
 *     customer's theme and Chris's own screenshot of it is LIGHT, so every surface here is a
 *     theme token. Only the gold accent and the dark tick on gold are literal.
 *   · the network list is filtered to groups with an active company wallet. TON — the
 *     "Lowest fee" row in the screenshot — is NOT offered, because there is no TON wallet to
 *     receive it. Offering it would take a real payment to an address we do not hold.
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

/**
 * The networks the original offered, mapped onto the wallet groups we hold. `time` strings are
 * verbatim from the source markup — they are the customer's expectation, not our measurement.
 * `badge` follows the screenshot's vocabulary; TON carried "Lowest fee" there and is absent here,
 * so it goes to the cheapest chain we can actually receive on.
 */
const NETWORKS: Array<{
  group: string; code: string; name: string; chain: string; time: string; badge?: 'Popular' | 'Lowest fee'
}> = [
  { group: 'EVM',   code: 'BEP20',   name: 'BEP-20',        chain: 'Binance Smart Chain', time: '≈ 1 min · 0.8 USDT', badge: 'Popular' },
  { group: 'TRC20', code: 'TRC20',   name: 'TRC-20',        chain: 'Tron',                time: '≈ 1 min · 1 USDT',   badge: 'Popular' },
  { group: 'EVM',   code: 'POLYGON', name: 'POL',           chain: 'Polygon',             time: '≈ 1 min · 0.8 USDT', badge: 'Lowest fee' },
  { group: 'SOL',   code: 'SOL',     name: 'SOL',           chain: 'Solana',              time: '≈ 1 min · 1 USDT' },
  { group: 'EVM',   code: 'ARB',     name: 'Arbitrum One',  chain: 'Arbitrum',            time: '≈ 2 min · 0.8 USDT' },
  { group: 'EVM',   code: 'OP',      name: 'Optimism',      chain: 'OP Mainnet',          time: '≈ 2 min · 0.8 USDT' },
  { group: 'EVM',   code: 'BASE',    name: 'Base',          chain: 'Coinbase L2',         time: '≈ 2 min · 0.8 USDT' },
  { group: 'EVM',   code: 'ERC20',   name: 'ERC-20',        chain: 'Ethereum Mainnet',    time: '≈ 5 min · 1.6 USDT' },
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

const GOLD = 'var(--gold, #D4A017)'
const money = (c: number) => `$${(c / 100).toFixed(2)}`

/** Human message out of authedFetch's raw "400 Bad Request: {json}". */
function humanError(e: any, fallback: string) {
  const raw = String(e?.message || '')
  const m = raw.match(/\{[\s\S]*\}$/)
  if (m) { try { const j = JSON.parse(m[0]); if (j?.error) return String(j.error) } catch {} }
  return raw && !/^\d{3}\b/.test(raw) ? raw : fallback
}

/** Numbered timeline dot. Done → gold with a tick; active → gold with its number; else outlined. */
function StepDot({ n, done, active }: { n: number; done: boolean; active: boolean }) {
  const filled = done || active
  return (
    <div style={{
      position: 'absolute', left: 0, width: 22, height: 22, borderRadius: '50%',
      background: filled ? GOLD : 'transparent',
      border: filled ? 'none' : '1px solid var(--line)',
      color: filled ? '#08080D' : 'var(--muted)',
      fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1, marginTop: 4, flexShrink: 0,
    }}>
      {done ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#08080D"
             strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : n}
    </div>
  )
}

function StepTitle({ children }: { children: any }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>{children}</div>
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
        // network = the wallet GROUP (finds the address); chain = what the customer actually
        // selected, so admin can check the right explorer instead of guessing across six EVM chains.
        body: JSON.stringify({ coin: w.coin, network: w.network, chain: code }),
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

  const CopyBtn = ({ on, k }: { on: string; k: string }) => (
    <button type="button" onClick={() => copy(on, k)}
            style={{ marginTop: 8, background: 'none', border: '1px solid var(--line)', borderRadius: 6,
                     padding: '6px 16px', fontSize: 11, color: copied === k ? GOLD : 'var(--muted)', cursor: 'pointer' }}>
      {copied === k ? 'Copied!' : 'Copy'}
    </button>
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
        const open = openPicker === inv.id
        const options = NETWORKS.filter(n => wallets.some(x => x.network === n.group))

        return (
          <div key={inv.id} className="card card-pad bp-card"
               // Only the OUTER border is red (Chris). Everything inside uses the same tokens as
               // the Current Billing Period card so the section does not look bolted on.
               style={payable ? { border: '1px solid rgba(255,77,79,0.45)' } : undefined}>
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
              <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 18 }}>

                {/* ══ STEPPED TIMELINE ══════════════════════════════════════════════ */}
                <div style={{ position: 'relative', paddingLeft: 34 }}>
                  {/* vertical connector */}
                  <div style={{
                    position: 'absolute', left: 10, top: 26, bottom: 26, width: 2, borderRadius: 2,
                    background: `linear-gradient(to bottom, color-mix(in srgb, ${GOLD} 50%, transparent), color-mix(in srgb, ${GOLD} 8%, transparent))`,
                    pointerEvents: 'none',
                  }} />

                  {/* ── Step 1 — the coin (always satisfied: we accept USDT/USDC only) ── */}
                  <div style={{ display: 'flex', marginBottom: 14 }}>
                    <StepDot n={1} done active={false} />
                    <div className="bp-cell" style={{ width: '100%', padding: 16 }}>
                      <StepTitle>Select a coin</StepTitle>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
                                    background: 'color-mix(in srgb, var(--text) 3%, transparent)',
                                    border: '1px solid var(--line)', borderRadius: 10, cursor: 'not-allowed' }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#26A17B', color: '#fff',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      fontSize: 15, fontWeight: 800, flexShrink: 0 }}>₮</div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>USDT <span style={{ color: 'var(--muted)', fontWeight: 600 }}>/ USDC</span></div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Tether USD · USD Coin</div>
                        </div>
                        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Fixed</div>
                      </div>
                    </div>
                  </div>

                  {/* ── Step 2 — the recipient network ── */}
                  <div style={{ display: 'flex', marginBottom: 14 }}>
                    <StepDot n={2} done={!!w} active={!w} />
                    <div className="bp-cell" style={{ width: '100%', padding: 16, overflow: 'visible' }}>
                      <StepTitle>Select recipient</StepTitle>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <label className="bp-eyebrow" style={{ margin: 0 }}>Network</label>
                        {chosen ? (
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                            Chain: <span style={{ fontFamily: 'var(--font-mono, monospace)', color: GOLD }}>{chosen.chain}</span>
                          </span>
                        ) : null}
                      </div>

                      {/* trigger */}
                      <button type="button" onClick={() => setOpenPicker(open ? null : inv.id)}
                              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                       gap: 10, padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                                       background: 'transparent', textAlign: 'left',
                                       border: `1px solid ${open || chosen ? GOLD : 'var(--line)'}`,
                                       color: chosen ? 'var(--text)' : 'var(--muted)', fontSize: 13, fontWeight: chosen ? 700 : 500 }}>
                        <span>{chosen ? `${chosen.name} · ${chosen.chain}` : 'Choose Network'}</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                             style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>

                      {/* panel */}
                      {open && (
                        <div style={{ marginTop: 6, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                          {/* sticky wrong-network warning */}
                          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '11px 13px',
                                        background: `color-mix(in srgb, ${GOLD} 7%, transparent)`, borderBottom: '1px solid var(--line)' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }}>
                              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            <span style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.45 }}>
                              Make sure the network you select <strong style={{ color: 'var(--text)' }}>matches the address you send from</strong> — wrong network = permanent loss.
                            </span>
                          </div>
                          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                            {options.map((n, i) => {
                              const sel = n.code === code
                              return (
                                <div key={n.code} onClick={() => { setNetFor(m => ({ ...m, [inv.id]: n.code })); setOpenPicker(null) }}
                                     style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                                              padding: '11px 14px', cursor: 'pointer',
                                              borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                                              background: sel ? `color-mix(in srgb, ${GOLD} 9%, transparent)` : 'transparent' }}>
                                  <div>
                                    <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                                      {n.name}
                                      {n.badge ? (
                                        <span style={{
                                          fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 6,
                                          background: n.badge === 'Lowest fee' ? 'rgba(34,197,94,0.14)' : `color-mix(in srgb, ${GOLD} 16%, transparent)`,
                                          color: n.badge === 'Lowest fee' ? 'var(--pos, #22c55e)' : GOLD,
                                        }}>{n.badge}</span>
                                      ) : null}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{n.chain}</div>
                                  </div>
                                  <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{n.time}</div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Step 3 — send it ── */}
                  <div style={{ display: 'flex' }}>
                    <StepDot n={3} done={false} active={!!w} />
                    <div className="bp-cell" style={{ width: '100%', padding: 16, opacity: w ? 1 : 0.55 }}>
                      <StepTitle>Send the payment</StepTitle>

                      <div className="bp-eyebrow" style={{ marginBottom: 6 }}>Send this exact amount</div>
                      <div style={{ textAlign: 'center', padding: '12px 10px', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 14 }}>
                        <div className="bp-cell-val bp-tone-gold" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 22 }}>{payAmt}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Must match exactly so the payment can be matched to this invoice</div>
                        <CopyBtn on={payAmt.replace('$', '')} k={`amt-${inv.id}`} />
                      </div>

                      <div className="bp-eyebrow" style={{ marginBottom: 6 }}>To this wallet address</div>
                      <div style={{ textAlign: 'center', padding: '12px 10px', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 16 }}>
                        {w ? (
                          <>
                            <div style={{ fontSize: 12, wordBreak: 'break-all', fontFamily: 'var(--font-mono, monospace)' }}>{w.wallet_address}</div>
                            <CopyBtn on={w.wallet_address} k={`addr-${inv.id}`} />
                          </>
                        ) : (
                          <div style={{ fontSize: 12, color: 'var(--muted)', padding: 6 }}>Choose a network in step 2 to reveal the address</div>
                        )}
                      </div>

                      {/* 2026-09-03 (Chris): this was green with a tick, which reads as "paid" before
                          the customer has done anything. Green is the SETTLED state, not the action. */}
                      <button type="button" disabled={busy === inv.id || !w} onClick={() => confirmCrypto(inv)}
                              style={{ width: '100%', background: w ? GOLD : 'transparent',
                                       color: w ? '#08080D' : 'var(--muted)',
                                       border: w ? 'none' : '1px solid var(--line)',
                                       borderRadius: 8, padding: 13, fontSize: 14, fontWeight: 700,
                                       cursor: w ? 'pointer' : 'not-allowed', opacity: w ? 1 : 0.6 }}>
                        {busy === inv.id ? 'Submitting…' : w ? 'I have sent the payment' : 'Choose a network first'}
                      </button>
                      <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>
                        We verify it manually, then mark the invoice paid. If nothing arrives within 72 hours, your card on file is charged automatically.
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── OR ── */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>OR</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                </div>

                {/* ── PAY WITH CARD ── */}
                {card ? (
                  <div className="bp-cell" style={{ padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>Pay with Card</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {(card.brand || 'Card').charAt(0).toUpperCase() + (card.brand || 'card').slice(1)} ending in {card.last4 || '****'}
                        </div>
                      </div>
                      <button type="button" disabled={busy === inv.id} onClick={() => chargeCard(inv)}
                              style={{ border: `1px solid ${GOLD}`, borderRadius: 8, padding: '10px 20px',
                                       fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                       background: `color-mix(in srgb, ${GOLD} 10%, transparent)`, color: GOLD }}>
                        {busy === inv.id ? 'Charging…' : `Charge ${money(inv.amount_cents)}`}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bp-cell" style={{ textAlign: 'center' }}>
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
