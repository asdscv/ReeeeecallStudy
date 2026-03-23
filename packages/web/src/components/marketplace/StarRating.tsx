interface StarRatingProps {
  rating: number
  max?: number
  size?: 'sm' | 'md' | 'lg'
  interactive?: boolean
  onChange?: (rating: number) => void
}

const SIZE_CLASSES = {
  sm: 'text-sm',
  md: 'text-lg',
  lg: 'text-2xl',
}

export function StarRating({
  rating,
  max = 5,
  size = 'md',
  interactive = false,
  onChange,
}: StarRatingProps) {
  const sizeClass = SIZE_CLASSES[size]

  return (
    <div className={`inline-flex gap-0.5 ${interactive ? 'cursor-pointer' : ''}`}>
      {Array.from({ length: max }, (_, i) => {
        const starValue = i + 1
        const filled = starValue <= Math.round(rating)

        return (
          <span
            key={i}
            className={`${sizeClass} ${filled ? 'text-yellow-400' : 'text-content-tertiary'} ${interactive ? 'hover:text-yellow-300 transition-colors' : ''}`}
            onClick={interactive && onChange ? () => onChange(starValue) : undefined}
            role={interactive ? 'button' : undefined}
            aria-label={interactive ? `Rate ${starValue} star${starValue !== 1 ? 's' : ''}` : undefined}
          >
            {'\u2605'}
          </span>
        )
      })}
    </div>
  )
}

/** Compact inline star display: "4.2 ★★★★☆ (12)" */
export function StarRatingInline({
  rating,
  count,
  size = 'sm',
}: {
  rating: number
  count: number
  size?: 'sm' | 'md'
}) {
  if (count === 0) return null

  return (
    <span className={`inline-flex items-center gap-1 ${size === 'sm' ? 'text-xs' : 'text-sm'} text-muted-foreground`}>
      <StarRating rating={rating} size={size} />
      <span className="font-medium text-foreground">{rating.toFixed(1)}</span>
      <span>({count})</span>
    </span>
  )
}
