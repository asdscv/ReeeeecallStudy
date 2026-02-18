import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, BookOpen } from 'lucide-react'
import { ApiDocsContent } from '../components/api-docs'

export function ApiDocsPage() {
  const navigate = useNavigate()
  const { t } = useTranslation('api-docs')

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
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('subtitle')}</p>
        </div>
        <Link
          to="/guide"
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition no-underline"
        >
          <BookOpen className="w-4 h-4" />
          {t('userGuideLink')}
        </Link>
      </div>

      <ApiDocsContent variant="authenticated" />
    </div>
  )
}
