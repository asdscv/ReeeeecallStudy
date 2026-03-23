import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search, ChevronDown, ChevronUp, ArrowLeft, ExternalLink, Link2, RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { GUIDE_SECTIONS, searchGuide, type GuideSection } from '../lib/guide-content'
import { useOnboardingStore } from '../stores/onboarding-store'

// ─── SectionCard ───────────────────────────────────────────

function SectionCard({
  section,
  defaultOpen,
  forceOpen,
  highlighted,
  t,
  onCopyLink,
}: {
  section: GuideSection
  defaultOpen: boolean
  forceOpen?: boolean
  highlighted?: boolean
  t: (key: string) => string
  onCopyLink: (sectionId: string) => void
}) {
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])

  return (
    <div
      id={`guide-${section.id}`}
      className={`bg-card rounded-xl border overflow-hidden transition-all duration-500 ${
        highlighted ? 'border-brand ring-2 ring-blue-100' : 'border-border'
      }`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-4 sm:p-5 text-left cursor-pointer hover:bg-muted transition group"
      >
        <span className="text-2xl shrink-0">{section.icon}</span>
        <h2 className="text-base sm:text-lg font-semibold text-foreground flex-1">{t(section.title)}</h2>
        <button
          onClick={(e) => { e.stopPropagation(); onCopyLink(section.id) }}
          className="p-1.5 text-content-tertiary hover:text-brand rounded-md hover:bg-brand/10 transition cursor-pointer opacity-0 group-hover:opacity-100 shrink-0"
          title={t('copyLink')}
        >
          <Link2 className="w-4 h-4" />
        </button>
        {open ? (
          <ChevronUp className="w-5 h-5 text-content-tertiary shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-content-tertiary shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-border divide-y divide-border">
          {section.items.map((item, i) => (
            <div key={i} className="px-4 sm:px-5 py-3 sm:py-4">
              <h3 className="text-sm font-semibold text-foreground mb-1.5">{t(item.title)}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{t(item.body)}</p>
              {item.images && item.images.length > 0 && (
                <div className="mt-3 space-y-3">
                  {item.images.map((img, imgIdx) => (
                    <div key={imgIdx} className="rounded-lg border border-border overflow-hidden">
                      <img
                        src={img.pc}
                        alt={img.alt || ''}
                        loading="lazy"
                        className="hidden sm:block w-full"
                      />
                      <img
                        src={img.mobile}
                        alt={img.alt || ''}
                        loading="lazy"
                        className="sm:hidden w-full"
                      />
                    </div>
                  ))}
                </div>
              )}
              {item.link && (
                <div className="mt-3">
                  {item.link.href ? (
                    <a
                      href={item.link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-brand bg-brand/10 hover:bg-brand/15 rounded-lg transition"
                    >
                      {t(item.link.label)}
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  ) : item.link.to ? (
                    <Link
                      to={item.link.to}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-brand bg-brand/10 hover:bg-brand/15 rounded-lg transition"
                    >
                      {t(item.link.label)}
                    </Link>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── TableOfContents ───────────────────────────────────────

function TableOfContents({ sections, onSelect, t }: { sections: GuideSection[]; onSelect: (id: string) => void; t: (key: string) => string }) {
  return (
    <nav className="bg-card rounded-xl border border-border p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-foreground mb-3">{t('tableOfContents')}</h2>
      <ul className="space-y-1.5">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => onSelect(s.id)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-brand transition cursor-pointer w-full text-left px-2 py-1 rounded-lg hover:bg-brand/10"
            >
              <span>{s.icon}</span>
              <span>{t(s.title)}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// ─── GuidePage ─────────────────────────────────────────────

export function GuidePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation('guide')
  const { t: tCommon } = useTranslation('common')
  const restartOnboarding = useOnboardingStore((s) => s.restart)
  const [query, setQuery] = useState('')
  const [openSectionId, setOpenSectionId] = useState<string | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const filtered = searchGuide(query, t)
  const isSearching = query.trim().length > 0

  // Handle hash-based deep link on mount and hash change
  const handleHash = useCallback(() => {
    const hash = location.hash.replace('#', '')
    if (hash && GUIDE_SECTIONS.some((s) => s.id === hash)) {
      setOpenSectionId(hash)
      setHighlightedId(hash)
      // Scroll after DOM update
      requestAnimationFrame(() => {
        setTimeout(() => {
          const el = sectionRefs.current[hash]
          if (!el) return
          const y = el.getBoundingClientRect().top + window.scrollY - 72
          window.scrollTo({ top: y, behavior: 'smooth' })
        }, 100)
      })
      // Remove highlight after animation
      setTimeout(() => setHighlightedId(null), 3000)
    }
  }, [location.hash])

  useEffect(() => {
    handleHash()
  }, [handleHash])

  const scrollToSection = (id: string) => {
    // Update URL hash without full navigation
    window.history.replaceState(null, '', `#${id}`)
    setOpenSectionId(id)
    setHighlightedId(id)
    requestAnimationFrame(() => {
      const el = sectionRefs.current[id]
      if (!el) return
      const y = el.getBoundingClientRect().top + window.scrollY - 72
      window.scrollTo({ top: y, behavior: 'smooth' })
    })
    setTimeout(() => setHighlightedId(null), 3000)
  }

  const copyDeepLink = (sectionId: string) => {
    const url = `${window.location.origin}/guide#${sectionId}`
    navigator.clipboard.writeText(url).then(() => {
      toast.success(t('linkCopied'))
    }).catch(() => {
      // Fallback for older browsers
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      toast.success(t('linkCopied'))
    })
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 sm:mb-6">
        <button
          onClick={() => navigate(-1)}
          className="p-2 text-content-tertiary hover:text-muted-foreground rounded-lg hover:bg-accent transition cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('subtitle')}</p>
        </div>
        <button
          onClick={restartOnboarding}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition cursor-pointer shrink-0"
        >
          <RotateCcw className="w-4 h-4" />
          <span className="hidden sm:inline">{tCommon('onboarding.restartOnboarding')}</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4 sm:mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-tertiary" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="w-full pl-10 pr-4 py-2.5 border border-border rounded-lg text-sm focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none"
        />
      </div>

      {/* Table of Contents (hidden when searching) */}
      {!isSearching && (
        <div className="mb-4 sm:mb-6">
          <TableOfContents sections={GUIDE_SECTIONS} onSelect={scrollToSection} t={t} />
        </div>
      )}

      {/* Sections */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-sm text-muted-foreground">{t('noResults', { query })}</p>
        </div>
      ) : (
        <div className="space-y-3 sm:space-y-4">
          {filtered.map((section) => (
            <div
              key={section.id}
              ref={(el) => { sectionRefs.current[section.id] = el }}
            >
              <SectionCard
                section={section}
                defaultOpen={isSearching}
                forceOpen={openSectionId === section.id}
                highlighted={highlightedId === section.id}
                t={t}
                onCopyLink={copyDeepLink}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
