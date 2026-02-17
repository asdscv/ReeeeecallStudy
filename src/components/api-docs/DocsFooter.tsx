import { Link } from 'react-router-dom'

export function DocsFooter() {
  return (
    <footer className="border-t border-gray-200 bg-gray-50 mt-12 sm:mt-16">
      <div className="max-w-4xl mx-auto px-4 py-8 sm:py-10">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/favicon.png" alt="" className="w-7 h-7" />
            <span className="font-bold text-gray-900">ReeeeecallStudy</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <Link to="/" className="hover:text-gray-700 transition no-underline">홈</Link>
            <Link to="/auth/login" className="hover:text-gray-700 transition no-underline">로그인</Link>
          </div>
          <p className="text-sm text-gray-400">
            &copy; 2026 ReeeeecallStudy. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
