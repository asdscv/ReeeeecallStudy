import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { API_DOCS_SECTIONS, searchApiDocs } from '../../lib/api-docs-content'
import { QuickStartBanner, type QuickStartVariant } from './QuickStartBanner'
import { TableOfContents } from './TableOfContents'
import { SectionCard } from './SectionCard'

export function ApiDocsContent({ variant }: { variant: QuickStartVariant }) {
  const { t } = useTranslation('api-docs')
  const [query, setQuery] = useState('')
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const filtered = searchApiDocs(query, t)
  const isSearching = query.trim().length > 0

  const scrollToSection = (id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    sectionRefs.current = {}
  }, [query])

  return (
    <>
      {/* Quick Start Banner */}
      <QuickStartBanner variant={variant} />

      {/* Search */}
      <div className="relative mb-4 sm:mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
        />
      </div>

      {/* Table of Contents */}
      {!isSearching && (
        <div className="mb-4 sm:mb-6">
          <TableOfContents sections={API_DOCS_SECTIONS} onSelect={scrollToSection} />
        </div>
      )}

      {/* Sections */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-sm text-gray-500">{t('noResults', { query })}</p>
        </div>
      ) : (
        <div className="space-y-3 sm:space-y-4">
          {filtered.map((section) => (
            <div
              key={`${section.id}-${isSearching}`}
              ref={(el) => { sectionRefs.current[section.id] = el }}
            >
              <SectionCard section={section} defaultOpen={isSearching} />
            </div>
          ))}
        </div>
      )}
    </>
  )
}
