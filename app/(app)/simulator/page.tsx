import { Suspense } from 'react'
import { SimulatorContent } from '@/components/cockpit/stax/SimulatorPage'

export const dynamic = 'force-dynamic'

export default function SimulatorPage() {
  return (
    <Suspense fallback={null}>
      <SimulatorContent />
    </Suspense>
  )
}
