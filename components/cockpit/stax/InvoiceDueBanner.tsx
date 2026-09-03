'use client'

/**
 * "Invoice Due" banner — ported 2026-09-03 from the pre-migration client-dashboard.
 *
 * Chris built this before the UI migration and it was never carried across. The original lived at
 * public/client-dashboard.html as #invoiceBanner, hidden by default and revealed by
 * _showInvoiceBanner(invoice); it switched to a harder red once the invoice went overdue. Same
 * behaviour here, same wording, reading the same endpoint that has been live all along.
 *
 * It links into Settings → Billing, where the invoice and both payment methods live — Chris put
 * billing there and it stays there.
 */

import { useEffect, useState } from 'react'
import { authedFetch } from '@/lib/api'

type Invoice = {
  id: string
  amount_cents: number
  description: string | null
  status: string
  due_at: string | null
}

export function InvoiceDueBanner() {
  const [inv, setInv] = useState<Invoice | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const j = await authedFetch<{ invoices: Invoice[] }>('/api/billing/invoices')
        if (cancelled) return
        // Oldest unpaid first — that is the one about to bite.
        const open = (j.invoices || [])
          .filter(i => i.status !== 'paid' && i.status !== 'void')
          .sort((a, b) => (Date.parse(a.due_at || '') || 0) - (Date.parse(b.due_at || '') || 0))
        setInv(open[0] || null)
      } catch { /* a failed poll is not "nothing is owed" — keep what we have */ }
    }
    load()
    const t = setInterval(load, 120_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  if (!inv) return null

  const amount = `$${(inv.amount_cents / 100).toFixed(2)}`
  const daysLeft = inv.due_at ? Math.round((Date.parse(inv.due_at) - Date.now()) / 86400_000) : null
  const overdue = inv.status === 'overdue' || (daysLeft != null && daysLeft < 0)
  const declared = inv.status === 'pending_verification'

  return (
    <div
      style={{
        margin: '16px 0', padding: '16px 20px', borderRadius: 12,
        border: `1px solid ${overdue ? 'rgba(239,68,68,0.4)' : 'rgba(239,68,68,0.25)'}`,
        background: overdue
          ? 'linear-gradient(135deg,rgba(239,68,68,0.10),rgba(239,68,68,0.04))'
          : 'linear-gradient(135deg,rgba(239,68,68,0.06),rgba(239,68,68,0.02))',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            background: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {declared ? 'Payment sent — confirming' : overdue ? '⚠️ Invoice Overdue' : 'Invoice Due'} — {amount}
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {declared
                ? 'We are confirming your transfer.'
                : inv.description || 'Performance fee invoice'}
              {!declared && daysLeft != null && (overdue
                ? ` · ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} overdue`
                : ` · due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`)}
            </div>
          </div>
        </div>
        {!declared && (
          <a href="/settings?tab=billing" className="btn"
             style={{ background: '#D4A017', color: '#08080D', fontWeight: 700, padding: '10px 18px', borderRadius: 8, textDecoration: 'none' }}>
            View &amp; Pay →
          </a>
        )}
      </div>
    </div>
  )
}
