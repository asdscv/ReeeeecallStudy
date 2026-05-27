/**
 * Skeleton — content-shaped loading placeholders.
 *
 * Replaces blank screens and emoji spinners with layout-matching pulses so
 * content swaps in without shift (CLS ~0). All variants mirror the real
 * layout they stand in for. Decorative → aria-hidden; containers expose
 * aria-busy for assistive tech.
 *
 * Extensible: compose <Skeleton> blocks for new variants; the base block
 * carries the pulse + token-driven color so dark mode adapts for free.
 */

interface SkeletonProps {
  className?: string
}

/** Base pulse block. `bg-foreground/10` stays visible on cards in light AND dark. */
export function Skeleton({ className = '' }: SkeletonProps) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-foreground/10 ${className}`} />
}

/** Card grid — matches `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` deck/listing grids. */
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-card rounded-xl border border-border p-4 sm:p-5">
          <Skeleton className="h-1.5 w-full mb-4 rounded-full" />
          <Skeleton className="h-5 w-2/3 mb-3" />
          <Skeleton className="h-3.5 w-full mb-2" />
          <Skeleton className="h-3.5 w-4/5 mb-4" />
          <div className="flex gap-2">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Vertical list rows — for share/history/template lists. */
export function ListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-card rounded-xl border border-border p-4 flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-4 w-1/3 mb-2" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-8 w-20 rounded-lg shrink-0" />
        </div>
      ))}
    </div>
  )
}

/** Dashboard — 4 stat cards + two chart panels. */
export function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border border-border p-4 sm:p-5">
            <Skeleton className="h-3 w-1/2 mb-3" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  )
}

/** Detail page — title + meta row + table-ish body. */
export function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6">
      <div>
        <Skeleton className="h-7 w-1/2 mb-3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    </div>
  )
}
