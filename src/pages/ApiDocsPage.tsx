import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, BookOpen } from 'lucide-react'
import { ApiDocsContent } from '../components/api-docs'

export function ApiDocsPage() {
  const navigate = useNavigate()

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

      <ApiDocsContent variant="authenticated" />
    </div>
  )
}
