import { Link } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface GuideHelpLinkProps {
  /** Guide section ID — becomes /guide#sectionId */
  section: string
  className?: string
}

export function GuideHelpLink({ section, className }: GuideHelpLinkProps) {
  const { t } = useTranslation('common')

  return (
    <Link
      to={`/guide#${section}`}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 bg-brand/10 hover:bg-brand/15 text-brand rounded-full text-xs font-medium transition shrink-0 no-underline ${className ?? ''}`}
    >
      <BookOpen className="w-3.5 h-3.5" />
      {t('guideHelp')}
    </Link>
  )
}
