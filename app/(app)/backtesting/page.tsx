import { BarChart3, Clock, Gauge, TrendingUp } from 'lucide-react'
import { SectionPlaceholder } from '@/components/cockpit/SectionPlaceholder'

export default function BacktestingPage() {
  return (
    <SectionPlaceholder
      title="Backtesting"
      subtitle="Strategy analysis components will use the shared stats, chart, and table language."
      metrics={[
        { label: 'Win Rate', value: '71.5%', caption: 'Last 50 trades', icon: Gauge },
        { label: 'Profit Factor', value: '1.78', caption: 'Gross profit / loss', icon: TrendingUp },
        { label: 'Runs', value: '5', caption: 'Asset basket', icon: BarChart3 },
        { label: 'Updated', value: '5m', caption: 'Mock freshness', icon: Clock },
      ]}
    />
  )
}
