import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

export function DocsNav() {
  const navigate = useNavigate()

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200/60">
      <div className="max-w-4xl mx-auto px-4 flex items-center justify-between py-3 sm:py-4">
        <div
          className="flex items-center gap-2.5 cursor-pointer"
          onClick={() => navigate('/')}
        >
          <img src="/favicon.png" alt="" className="w-9 h-9 sm:w-10 sm:h-10" />
          <span className="font-bold text-gray-900 text-lg sm:text-xl">ReeeeecallStudy</span>
        </div>
        <button
          onClick={() => navigate('/auth/login')}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition cursor-pointer"
        >
          시작하기 <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </header>
  )
}
