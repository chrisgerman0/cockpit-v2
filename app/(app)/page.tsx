import { Suspense } from 'react'
import { DashboardHomeClient } from './page-client'

// Dashboard root. Wrapped in Suspense so useSearchParams() (consumed by
// DashboardHomeClient for ?setup=bot and ?replayTour=) doesn't push the
// whole tree to client-render. The actual dashboard render happens in
// DashboardHomeClient via DashboardLive.
export default function DashboardHome() {
  return (
    <Suspense fallback={null}>
      <DashboardHomeClient />
    </Suspense>
  )
}
