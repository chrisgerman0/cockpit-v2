import { Suspense } from 'react'
import { SettingsContent } from '@/components/cockpit/stax/SettingsPage'

export const dynamic = 'force-dynamic'

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  )
}
