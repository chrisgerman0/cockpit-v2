import { Suspense } from 'react'
import { AdminContent } from '@/components/cockpit/stax/AdminPage'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminContent />
    </Suspense>
  )
}
