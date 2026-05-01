import { Activity, Bot, ShieldCheck, TrendingUp } from 'lucide-react'
import { SectionPlaceholder } from '@/components/cockpit/SectionPlaceholder'

export default function LivePage() {
  return (
    <SectionPlaceholder
      title="Live Trading"
      subtitle="Live execution views inherit the Obsidian Ledger shell while data wiring stays mocked."
      metrics={[
        { label: 'Bot Status', value: 'Active', caption: 'Watching', icon: Bot },
        { label: 'Unrealized PNL', value: '$0', caption: 'No open position', icon: TrendingUp },
        { label: 'Signals', value: '0', caption: 'No pending entries', icon: Activity },
        { label: 'Risk', value: 'OK', caption: 'Guards online', icon: ShieldCheck },
      ]}
    />
  )
}
