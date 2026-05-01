import { Activity, CircleDollarSign, Landmark, ShieldCheck } from 'lucide-react'
import { SectionPlaceholder } from '@/components/cockpit/SectionPlaceholder'

export default function BrokerPage() {
  return (
    <SectionPlaceholder
      title="Broker"
      subtitle="Broker account surfaces inherit the cockpit design tokens and responsive card model."
      metrics={[
        { label: 'Exchange', value: 'Bitget', caption: 'Connected', icon: Landmark },
        { label: 'Balance', value: '$4,728', caption: 'Mock wallet', icon: CircleDollarSign },
        { label: 'Margin', value: 'OK', caption: 'Healthy', icon: ShieldCheck },
        { label: 'Orders', value: '0', caption: 'No pending fills', icon: Activity },
      ]}
    />
  )
}
