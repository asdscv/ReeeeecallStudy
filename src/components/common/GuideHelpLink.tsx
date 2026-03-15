import { Link } from 'react-router-dom'
import { CircleHelp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface GuideHelpLinkProps {
  /** Guide section ID — becomes /guide#sectionId */
  section: string
  /** Show label text (default: false = icon only) */
  showLabel?: boolean
  className?: string
}

export function GuideHelpLink({ section, showLabel, className }: GuideHelpLinkProps) {
  const { t } = useTranslation('common')

  return (
    <Link
      to={`/guide#${section}`}
      className={`inline-flex items-center gap-1 text-gray-400 hover:text-blue-500 transition shrink-0 ${className ?? ''}`}
      title={t('guideHelp')}
    >
      <CircleHelp className="w-4 h-4" />
      {showLabel && (
        <span className="text-xs">{t('guideHelp')}</span>
      )}
    </Link>
  )
}
