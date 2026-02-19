import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Menu, X } from 'lucide-react'

interface ContentNavProps {
  backTo?: string
  backLabel?: string
}

export function ContentNav({ backTo, backLabel }: ContentNavProps) {
  const { t } = useTranslation('landing')
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200/60">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between py-3">
        <div className="flex items-center gap-4">
          {backTo && (
            <Link
              to={backTo}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition no-underline"
            >
              <ArrowLeft className="w-4 h-4" />
              {backLabel}
            </Link>
          )}
          <Link to="/landing" className="flex items-center gap-2 no-underline">
            <img src="/favicon.png" alt="" className="w-8 h-8" />
            <span className="font-bold text-gray-900 hidden sm:inline">ReeeeecallStudy</span>
          </Link>
        </div>

        {/* Desktop nav */}
        <div className="hidden sm:flex items-center gap-3">
          <Link
            to="/auth/login"
            className="text-sm text-gray-600 hover:text-gray-900 transition no-underline"
          >
            {t('nav.login')}
          </Link>
          <Link
            to="/auth/login"
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition no-underline"
          >
            {t('hero.cta.start', 'Get Started')}
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="sm:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg cursor-pointer"
          aria-label="Menu"
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="sm:hidden border-t border-gray-100 bg-white/95 backdrop-blur-md">
          <nav className="max-w-7xl mx-auto px-4 py-3 flex flex-col gap-1">
            <Link
              to="/auth/login"
              onClick={() => setMenuOpen(false)}
              className="px-3 py-3 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition no-underline"
            >
              {t('nav.login')}
            </Link>
            <Link
              to="/auth/login"
              onClick={() => setMenuOpen(false)}
              className="mx-3 mt-1 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition no-underline text-center"
            >
              {t('hero.cta.start', 'Get Started')}
            </Link>
          </nav>
        </div>
      )}
    </header>
  )
}
