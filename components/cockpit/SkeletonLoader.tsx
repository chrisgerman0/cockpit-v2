import { Skeleton } from '@/components/ui/skeleton'

/**
 * Inline loader used by cockpit cards while mock/live data resolves.
 */
export function SkeletonLoader() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
}
