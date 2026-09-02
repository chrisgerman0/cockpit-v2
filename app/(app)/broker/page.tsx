/**
 * ── BROKER PROGRAM — PARKED 2026-09-02, NOT DELETED ──────────────────────────────────────────
 * Chris: "I may rip out the broker system from the get go. I don't want to grow fast and have
 * non-believers spreading the word. I PREFER ORGANIC — I will disperse the value into the token
 * as originally planned." And: "we may revisit later — save it properly, make a note, only hide
 * the broker page, DO NOT DELETE."
 *
 * WHAT IT DID. A referral scheme: each user got a code (BRK-XXXXX) and a share of the 20%
 * performance fee earned from customers they referred, split per profiles.broker_split_pct.
 * It was auto-approved for everyone — there was no application gate.
 *
 * WHAT IS STILL HERE, UNTOUCHED. The UI components (broker-dashboard.tsx here,
 * cockpit/stax/BrokerPage.tsx in the dashboard), the API routes under app/api/broker and
 * app/api/admin/broker, the tables (broker_splits, invoices, period_fees, profiles.broker_split_pct)
 * and the ?ref= capture on signup. All of it inert: the tables hold nothing, and nothing computes
 * a commission because no invoice has ever been generated. It costs nothing to leave in place.
 *
 * HOW TO BRING IT BACK. Restore the body below, then re-add the nav entries marked
 * "BROKER PARKED 2026-09-02" in components/dashboard-layout.tsx,
 * cockpit/stax/StaxDashboard.tsx (desktop + mobile) and components/admin/admin-sidebar.tsx.
 * Nothing else was changed.
 */
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function BrokerPage() {
  notFound()
}

/* ORIGINAL — restore exactly this to bring the page back:
import { BrokerContent } from '@/components/cockpit/stax/BrokerPage'

export const dynamic = 'force-dynamic'

export default function BrokerPage() {
  return <BrokerContent />
}
*/
