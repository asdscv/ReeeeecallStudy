import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { getMethodColor, getStatusColor, type ApiEndpoint } from '../../lib/api-docs-content'
import { CodeBlock } from './CodeBlock'

export function EndpointCard({ endpoint }: { endpoint: ApiEndpoint }) {
  const { t } = useTranslation('api-docs')
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
        <span className="text-xs text-gray-500 hidden sm:inline shrink-0">{t(endpoint.summary)}</span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-gray-100 p-4 space-y-4 bg-gray-50/50">
          <p className="text-sm text-gray-700">{t(endpoint.description)}</p>

          {endpoint.headers && endpoint.headers.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Headers</h4>
              <div className="space-y-1">
                {endpoint.headers.map((h) => (
                  <div key={h.name} className="flex items-center gap-2 text-xs">
                    <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-gray-700">{h.name}</code>
                    <span className="text-gray-400">:</span>
                    <code className="text-gray-500">{h.value}</code>
                    {h.required && <span className="text-red-400 text-[10px]">{t('required')}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {endpoint.pathParams && endpoint.pathParams.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Path Parameters</h4>
              <div className="space-y-1.5">
                {endpoint.pathParams.map((p) => (
                  <div key={p.name} className="text-xs">
                    <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-gray-700">{p.name}</code>
                    <span className="text-gray-400 ml-2">{p.type}</span>
                    <span className="text-gray-500 ml-2">— {t(p.description)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {endpoint.queryParams && endpoint.queryParams.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Query Parameters</h4>
              <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                <table className="w-full text-xs whitespace-nowrap">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-2 font-medium text-gray-600">{t('table.name')}</th>
                      <th className="text-left p-2 font-medium text-gray-600">{t('table.type')}</th>
                      <th className="text-left p-2 font-medium text-gray-600">{t('table.required')}</th>
                      <th className="text-left p-2 font-medium text-gray-600">{t('table.description')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {endpoint.queryParams.map((p) => (
                      <tr key={p.name}>
                        <td className="p-2"><code className="font-mono text-gray-700">{p.name}</code></td>
                        <td className="p-2 text-gray-500">{p.type}</td>
                        <td className="p-2">{p.required ? <span className="text-red-500">Y</span> : <span className="text-gray-400">N</span>}</td>
                        <td className="p-2 text-gray-600">{t(p.description)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {endpoint.requestBody && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Request Body</h4>
              <CodeBlock code={endpoint.requestBody} language="json" />
            </div>
          )}

          {endpoint.responseBody && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Response</h4>
              <CodeBlock code={endpoint.responseBody} language="json" />
            </div>
          )}

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
                    <span className="text-gray-500">{t(sc.description)}</span>
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
