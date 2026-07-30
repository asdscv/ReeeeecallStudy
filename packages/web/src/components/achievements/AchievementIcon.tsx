import { getAchievementIcon, getCategoryIcon } from '../../lib/achievement-icons'

/**
 * Render an achievement icon as a circular badge
 */
export function AchievementIcon({
  id,
  category,
  dbIcon,
  size = 'md',
  earned = true,
}: {
  id: string
  category: string
  dbIcon?: string
  size?: 'sm' | 'md' | 'lg'
  earned?: boolean
}) {
  const config = getAchievementIcon(id, category, dbIcon)
  const Icon = config.icon

  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
  }

  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  }

  return (
    <div className={`${sizeClasses[size]} rounded-full flex items-center justify-center ${
      earned ? config.bg : 'bg-accent'
    } ${!earned ? 'opacity-40' : ''} transition-all`}>
      <Icon className={`${iconSizes[size]} ${earned ? config.color : 'text-content-tertiary'}`} />
    </div>
  )
}

/**
 * Render a category icon
 */
export function CategoryIcon({ category, size = 'md' }: { category: string; size?: 'sm' | 'md' }) {
  const config = getCategoryIcon(category)
  const Icon = config.icon
  const s = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6'
  return <Icon className={`${s} ${config.color}`} />
}
