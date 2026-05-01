import { SearchX } from 'lucide-react'

/**
 * Calm empty state for cards that have no rows yet.
 */
export function EmptyState({ title = 'No data yet', body = 'This panel will populate once activity starts.' }: { title?: string; body?: string }) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-md border border-dashed border-border/80 p-6 text-center">
      <SearchX className="h-8 w-8 text-muted-foreground" />
      <div className="mt-3 font-semibold">{title}</div>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
    </div>
  )
}
