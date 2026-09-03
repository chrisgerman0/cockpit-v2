import { Suspense } from 'react'
import { BillingContent } from '@/components/cockpit/stax/BillingPage'

export const dynamic = 'force-dynamic'

export default function BillingPage() {
  return (
    <Suspense fallback={null}>
      <BillingContent />
    </Suspense>
  )
}
