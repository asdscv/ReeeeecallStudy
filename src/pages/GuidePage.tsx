import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react'
import { GUIDE_SECTIONS, searchGuide, type GuideSection } from '../lib/guide-content'

function SectionCard({ section, defaultOpen }: { section: GuideSection; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-4 sm:p-5 text-left cursor-pointer hover:bg-gray-50 transition"
      >
        <span className="text-2xl shrink-0">{section.icon}</span>
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 flex-1">{section.title}</h2>
        {open ? (
          <ChevronUp className="w-5 h-5 text-gray-400 shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-gray-100 divide-y divide-gray-100">
          {section.items.map((item, i) => (
            <div key={i} className="px-4 sm:px-5 py-3 sm:py-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-1.5">{item.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{item.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TableOfContents({ sections, onSelect }: { sections: GuideSection[]; onSelect: (id: string) => void }) {
  return (
    <nav className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">목차</h2>
      <ul className="space-y-1.5">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => onSelect(s.id)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-blue-600 transition cursor-pointer w-full text-left px-2 py-1 rounded-lg hover:bg-blue-50"
            >
              <span>{s.icon}</span>
              <span>{s.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function GuidePage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const filtered = searchGuide(query)
  const isSearching = query.trim().length > 0

  const scrollToSection = (id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Reset refs when filtered changes
  useEffect(() => {
    sectionRefs.current = {}
  }, [query])

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 sm:mb-6">
        <button
          onClick={() => navigate(-1)}
          className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">사용법 가이드</h1>
          <p className="text-sm text-gray-500 mt-0.5">ReeeeecallStudy의 모든 기능을 알아보세요</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4 sm:mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="기능 검색 (예: SRS, 가져오기, 공유...)"
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
        />
      </div>

      {/* Table of Contents (hidden when searching) */}
      {!isSearching && (
        <div className="mb-4 sm:mb-6">
          <TableOfContents sections={GUIDE_SECTIONS} onSelect={scrollToSection} />
        </div>
      )}

      {/* Sections */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-sm text-gray-500">"{query}"에 대한 결과가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3 sm:space-y-4">
          {filtered.map((section) => (
            <div
              key={section.id}
              ref={(el) => { sectionRefs.current[section.id] = el }}
            >
              <SectionCard section={section} defaultOpen={isSearching} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
