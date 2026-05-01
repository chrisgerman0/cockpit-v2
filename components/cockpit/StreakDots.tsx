import { cn } from '@/lib/utils'

type StreakDotsProps = {
  results: Array<'W' | 'L'>
  className?: string
}

/**
 * Encodes recent win/loss rhythm without taking table space.
 */
export function StreakDots({ results, className }: StreakDotsProps) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)} aria-label="Recent win loss streak">
      {results.map((result, index) => (
        <span
          key={`${result}-${index}`}
          className={cn('h-2.5 w-2.5 rounded-full', result === 'W' ? 'bg-positive' : 'bg-negative')}
          title={result === 'W' ? 'Win' : 'Loss'}
        />
      ))}
    </div>
  )
}
