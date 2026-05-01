import { Activity, Bell, Rocket, Users } from 'lucide-react'
import { SectionPlaceholder } from '@/components/cockpit/SectionPlaceholder'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function AdminOverview() {
  return (
    <SectionPlaceholder
      title="Admin"
      subtitle="Pipeline and account operations will be migrated after the design system lands."
      metrics={[
        { label: 'Open Positions', value: '0', caption: 'Flat', icon: Rocket },
        { label: 'Pending Fills', value: '0', caption: 'Exchange clear', icon: Activity },
        { label: 'Alerts', value: '0', caption: 'No unresolved alerts', icon: Bell },
        { label: 'Users', value: '—', caption: 'Auth pending', icon: Users },
      ]}
    />
  )
}
