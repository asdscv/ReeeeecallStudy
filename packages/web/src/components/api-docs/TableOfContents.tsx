import { useTranslation } from 'react-i18next'
import { BookOpen, ChevronRight } from 'lucide-react'
import { type ApiDocsSection } from '../../lib/api-docs-content'

export function TableOfContents({ sections, onSelect }: { sections: ApiDocsSection[]; onSelect: (id: string) => void }) {
  const { t } = useTranslation('api-docs')

  return (
    <nav className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <BookOpen className="w-4 h-4" />
        {t('tableOfContents')}
      </h2>
      <ul className="space-y-1">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => onSelect(s.id)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-blue-600 transition cursor-pointer w-full text-left px-2 py-1.5 rounded-lg hover:bg-blue-50"
            >
              <span>{s.icon}</span>
              <span className="flex-1">{t(s.title)}</span>
              <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
