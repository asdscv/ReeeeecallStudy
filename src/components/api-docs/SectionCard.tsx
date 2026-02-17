import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { type ApiDocsSection } from '../../lib/api-docs-content'
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
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-4 sm:p-5 text-left cursor-pointer hover:bg-gray-50 transition"
      >
        <span className="text-2xl shrink-0">{section.icon}</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900">{section.title}</h2>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{section.description}</p>
        </div>
        {open ? (
          <ChevronUp className="w-5 h-5 text-gray-400 shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-gray-100">
          {section.items && section.items.length > 0 && (
            <div className="divide-y divide-gray-100">
              {section.items.map((item, i) => (
                <div key={i} className="px-4 sm:px-5 py-3 sm:py-4">
                  <h3 className="text-sm font-semibold text-gray-800 mb-1.5">{item.title}</h3>
                  {isCodeContent(item.body) ? (
                    <CodeBlock code={item.body} />
                  ) : (
                    <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{item.body}</p>
                  )}
                </div>
              ))}
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
