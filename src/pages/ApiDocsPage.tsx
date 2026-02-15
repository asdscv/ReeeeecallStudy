import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Search, ChevronDown, ChevronUp, ArrowLeft, Copy, Check, BookOpen, ChevronRight } from 'lucide-react'
import {
  API_DOCS_SECTIONS,
  searchApiDocs,
  getMethodColor,
  getStatusColor,
  type ApiDocsSection,
  type ApiEndpoint,
} from '../lib/api-docs-content'

// ─── Code Block (복사 기능 포함) ─────────────────────────
function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  return (
    <div className="relative group mt-2">
      {language && (
        <span className="absolute top-2 left-3 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
          {language}
        </span>
      )}
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 opacity-0 group-hover:opacity-100 transition cursor-pointer"
        title="복사"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 pt-7 text-xs sm:text-sm overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

// ─── Endpoint Card ──────────────────────────────────────
function EndpointCard({ endpoint }: { endpoint: ApiEndpoint }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-3 sm:p-4 text-left hover:bg-gray-50 transition cursor-pointer"
      >
        <span className={`px-2 py-0.5 rounded text-xs font-bold shrink-0 ${getMethodColor(endpoint.method)}`}>
          {endpoint.method}
        </span>
        <code className="text-sm text-gray-700 font-mono flex-1 truncate">{endpoint.path}</code>
        <span className="text-xs text-gray-500 hidden sm:inline shrink-0">{endpoint.summary}</span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-gray-100 p-4 space-y-4 bg-gray-50/50">
          {/* Summary */}
          <p className="text-sm text-gray-700">{endpoint.description}</p>

          {/* Headers */}
          {endpoint.headers && endpoint.headers.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Headers</h4>
              <div className="space-y-1">
                {endpoint.headers.map((h) => (
                  <div key={h.name} className="flex items-center gap-2 text-xs">
                    <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-gray-700">{h.name}</code>
                    <span className="text-gray-400">:</span>
                    <code className="text-gray-500">{h.value}</code>
                    {h.required && <span className="text-red-400 text-[10px]">필수</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Path Parameters */}
          {endpoint.pathParams && endpoint.pathParams.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Path Parameters</h4>
              <div className="space-y-1.5">
                {endpoint.pathParams.map((p) => (
                  <div key={p.name} className="text-xs">
                    <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-gray-700">{p.name}</code>
                    <span className="text-gray-400 ml-2">{p.type}</span>
                    <span className="text-gray-500 ml-2">— {p.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Query Parameters */}
          {endpoint.queryParams && endpoint.queryParams.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Query Parameters</h4>
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-2 font-medium text-gray-600">이름</th>
                      <th className="text-left p-2 font-medium text-gray-600">타입</th>
                      <th className="text-left p-2 font-medium text-gray-600">필수</th>
                      <th className="text-left p-2 font-medium text-gray-600">설명</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {endpoint.queryParams.map((p) => (
                      <tr key={p.name}>
                        <td className="p-2"><code className="font-mono text-gray-700">{p.name}</code></td>
                        <td className="p-2 text-gray-500">{p.type}</td>
                        <td className="p-2">{p.required ? <span className="text-red-500">Y</span> : <span className="text-gray-400">N</span>}</td>
                        <td className="p-2 text-gray-600">{p.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Request Body */}
          {endpoint.requestBody && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Request Body</h4>
              <CodeBlock code={endpoint.requestBody} language="json" />
            </div>
          )}

          {/* Response Body */}
          {endpoint.responseBody && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Response</h4>
              <CodeBlock code={endpoint.responseBody} language="json" />
            </div>
          )}

          {/* Status Codes */}
          {endpoint.statusCodes && endpoint.statusCodes.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Status Codes</h4>
              <div className="flex flex-wrap gap-2">
                {endpoint.statusCodes.map((sc) => (
                  <span
                    key={sc.code}
                    className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-gray-100 ${getStatusColor(sc.code)}`}
                  >
                    <span className="font-bold">{sc.code}</span>
                    <span className="text-gray-500">{sc.description}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Section Card ──────────────────────────────────────
function SectionCard({ section, defaultOpen }: { section: ApiDocsSection; defaultOpen: boolean }) {
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
          {/* Text Items */}
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

          {/* Endpoints */}
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

// ─── Table of Contents ─────────────────────────────────
function TableOfContents({ sections, onSelect }: { sections: ApiDocsSection[]; onSelect: (id: string) => void }) {
  return (
    <nav className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <BookOpen className="w-4 h-4" />
        목차
      </h2>
      <ul className="space-y-1">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => onSelect(s.id)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-blue-600 transition cursor-pointer w-full text-left px-2 py-1.5 rounded-lg hover:bg-blue-50"
            >
              <span>{s.icon}</span>
              <span className="flex-1">{s.title}</span>
              <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// ─── Helpers ──────────────────────────────────────────
function isCodeContent(text: string): boolean {
  return (
    text.includes('curl ') ||
    text.includes('fetch(') ||
    text.includes('requests.') ||
    text.includes('const ') ||
    text.includes('import ')
  )
}

// ─── Main Page ──────────────────────────────────────
export function ApiDocsPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const filtered = searchApiDocs(query)
  const isSearching = query.trim().length > 0

  const scrollToSection = (id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    sectionRefs.current = {}
  }, [query])

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 sm:mb-6">
        <button
          onClick={() => navigate(-1)}
          className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">API 문서</h1>
          <p className="text-sm text-gray-500 mt-0.5">외부 도구와 연동하여 학습 데이터를 관리하세요</p>
        </div>
        <Link
          to="/guide"
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition no-underline"
        >
          <BookOpen className="w-4 h-4" />
          사용법 가이드
        </Link>
      </div>

      {/* Quick Start Banner */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 sm:p-5 mb-4 sm:mb-6">
        <h2 className="text-sm font-semibold text-blue-900 mb-2">빠른 시작</h2>
        <div className="space-y-2 text-xs sm:text-sm text-blue-800">
          <p>1. <Link to="/settings" className="underline font-medium">설정 페이지</Link>에서 API 키를 생성하세요</p>
          <p>2. 모든 요청에 <code className="bg-blue-100 px-1.5 py-0.5 rounded text-blue-900 font-mono text-xs">Authorization: Bearer rc_...</code> 헤더를 포함하세요</p>
          <p>3. 아래 엔드포인트를 참고하여 API를 호출하세요</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4 sm:mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="API 검색 (예: 카드 생성, GET, /decks...)"
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
          <p className="text-sm text-gray-500">"{query}"에 대한 결과가 없습니다.</p>
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
    </div>
  )
}
