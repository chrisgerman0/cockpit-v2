import type { LucideIcon } from 'lucide-react'
import { StatTile } from './StatTile'
import { EmptyState } from './EmptyState'

type SectionPlaceholderProps = {
  title: string
  subtitle: string
  metrics: Array<{
    label: string
    value: string
    caption: string
    icon: LucideIcon
  }>
}

/**
 * Styled placeholder used while non-dashboard sections migrate from v1.
 */
export function SectionPlaceholder({ title, subtitle, metrics }: SectionPlaceholderProps) {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 pb-20 sm:px-5">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(metric => <StatTile key={metric.label} {...metric} />)}
      </div>
      <div className="mt-3 cockpit-card rounded-md p-4">
        <EmptyState title={`${title} migration pending`} body="This section now uses the shared cockpit shell and will receive its full v1 parity pass in a follow-up PR." />
      </div>
    </div>
  )
}
