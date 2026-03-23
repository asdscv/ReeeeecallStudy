import { useTranslation } from 'react-i18next'
import { BookOpen, ChevronRight } from 'lucide-react'
import { type ApiDocsSection } from '../../lib/api-docs-content'

export function TableOfContents({ sections, onSelect }: { sections: ApiDocsSection[]; onSelect: (id: string) => void }) {
  const { t } = useTranslation('api-docs')

  return (
    <nav className="bg-card rounded-xl border border-border p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <BookOpen className="w-4 h-4" />
        {t('tableOfContents')}
      </h2>
      <ul className="space-y-1">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => onSelect(s.id)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-brand transition cursor-pointer w-full text-left px-2 py-1.5 rounded-lg hover:bg-brand/10"
            >
              <span>{s.icon}</span>
              <span className="flex-1">{t(s.title)}</span>
              <ChevronRight className="w-3.5 h-3.5 text-content-tertiary" />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
