import { Bell, Globe2, Palette, ShieldCheck } from 'lucide-react'
import { SectionPlaceholder } from '@/components/cockpit/SectionPlaceholder'

export default function SettingsPage() {
  return (
    <SectionPlaceholder
      title="Settings"
      subtitle="Preferences keep the new top-bar language and theme behavior."
      metrics={[
        { label: 'Theme', value: 'Dark', caption: 'Persisted locally', icon: Palette },
        { label: 'Language', value: 'ENG', caption: 'PT available', icon: Globe2 },
        { label: 'Alerts', value: 'On', caption: 'Notifications enabled', icon: Bell },
        { label: 'Security', value: 'OK', caption: 'Session active', icon: ShieldCheck },
      ]}
    />
  )
}
