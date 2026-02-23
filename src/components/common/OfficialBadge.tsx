import { useTranslation } from 'react-i18next'

interface OfficialBadgeProps {
  className?: string
  size?: 'sm' | 'md'
}

const sizeClasses = {
  sm: 'text-xs px-1.5 py-0.5',
  md: 'text-sm px-2 py-0.5',
}

export function OfficialBadge({ className = '', size = 'sm' }: OfficialBadgeProps) {
  const { t } = useTranslation('common')

  return (
    <span
      data-testid="official-badge"
      role="status"
      aria-label={t('officialBadge.tooltip')}
      className={`inline-flex items-center gap-0.5 rounded-full bg-blue-100 text-blue-700 font-medium ${sizeClasses[size]} ${className}`}
      title={t('officialBadge.tooltip')}
    >
      <svg
        className="w-3 h-3"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
      {t('officialBadge.label')}
    </span>
  )
}
