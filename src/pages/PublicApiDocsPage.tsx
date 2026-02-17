import { DocsNav, DocsFooter, ApiDocsContent } from '../components/api-docs'

export function PublicApiDocsPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <DocsNav />

      <main className="flex-1 px-4 py-6 sm:py-10">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900">API 문서</h1>
            <p className="text-sm sm:text-base text-gray-500 mt-1">
              ReeeeecallStudy API로 외부 도구와 연동하여 학습 데이터를 관리하세요
            </p>
          </div>

          <ApiDocsContent variant="public" />
        </div>
      </main>

      <DocsFooter />
    </div>
  )
}
