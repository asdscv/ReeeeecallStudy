import { useTranslation } from 'react-i18next'
import type { BadgeType } from '../../types/database'

interface OfficialBadgeProps {
  className?: string
  size?: 'sm' | 'md'
  badgeType?: BadgeType
  badgeColor?: string
}

const sizeClasses = {
  sm: 'text-xs px-1.5 py-0.5',
  md: 'text-sm px-2 py-0.5',
}

const BADGE_CONFIG: Record<BadgeType, { label: string; bgClass: string; textClass: string }> = {
  verified: { label: 'Verified', bgClass: 'bg-brand/15', textClass: 'text-brand' },
  official: { label: 'Official', bgClass: 'bg-purple-100', textClass: 'text-purple-700' },
  educator: { label: 'Educator', bgClass: 'bg-success/15', textClass: 'text-success' },
  publisher: { label: 'Publisher', bgClass: 'bg-warning/15', textClass: 'text-warning' },
  partner: { label: 'Partner', bgClass: 'bg-destructive/15', textClass: 'text-destructive' },
}

export function OfficialBadge({ className = '', size = 'sm', badgeType = 'verified', badgeColor }: OfficialBadgeProps) {
  const { t } = useTranslation('common')
  const config = BADGE_CONFIG[badgeType] || BADGE_CONFIG.verified

  const colorStyle = badgeColor
    ? { backgroundColor: `${badgeColor}1A`, color: badgeColor }
    : undefined

  return (
    <span
      data-testid="official-badge"
      data-badge-type={badgeType}
      role="status"
      aria-label={t('officialBadge.tooltip', { defaultValue: `${config.label} account` })}
      className={`inline-flex items-center gap-0.5 rounded-full font-medium ${sizeClasses[size]} ${
        colorStyle ? '' : `${config.bgClass} ${config.textClass}`
      } ${className}`}
      style={colorStyle}
      title={t('officialBadge.tooltip', { defaultValue: `${config.label} account` })}
    >
      <svg
        className="w-3 h-3"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
      {config.label}
    </span>
  )
}
