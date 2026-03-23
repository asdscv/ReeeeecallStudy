import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { CODE_EXAMPLES, type ApiDocsSection } from '../../lib/api-docs-content'
import { CodeBlock } from './CodeBlock'
import { EndpointCard } from './EndpointCard'

export function isCodeContent(text: string): boolean {
  return (
    text.includes('curl ') ||
    text.includes('fetch(') ||
    text.includes('requests.') ||
    text.includes('const ') ||
    text.includes('import ')
  )
}

export function SectionCard({ section, defaultOpen }: { section: ApiDocsSection; defaultOpen: boolean }) {
  const { t } = useTranslation('api-docs')
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-4 sm:p-5 text-left cursor-pointer hover:bg-muted transition"
      >
        <span className="text-2xl shrink-0">{section.icon}</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-foreground">{t(section.title)}</h2>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{t(section.description)}</p>
        </div>
        {open ? (
          <ChevronUp className="w-5 h-5 text-content-tertiary shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-content-tertiary shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-border">
          {section.items && section.items.length > 0 && (
            <div className="divide-y divide-border">
              {section.items.map((item, i) => {
                const itemTitle = item.isCode ? item.title : t(item.title)
                const itemBody = item.isCode
                  ? (CODE_EXAMPLES[Object.keys(CODE_EXAMPLES).find(k => CODE_EXAMPLES[k].title === item.title) || '']?.code || '')
                  : t(item.body)
                return (
                  <div key={i} className="px-4 sm:px-5 py-3 sm:py-4">
                    <h3 className="text-sm font-semibold text-foreground mb-1.5">{itemTitle}</h3>
                    {item.isCode || isCodeContent(itemBody) ? (
                      <CodeBlock code={itemBody} />
                    ) : (
                      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{itemBody}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {section.endpoints && section.endpoints.length > 0 && (
            <div className="p-4 sm:p-5 space-y-3">
              {section.endpoints.map((ep, i) => (
                <EndpointCard key={i} endpoint={ep} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
