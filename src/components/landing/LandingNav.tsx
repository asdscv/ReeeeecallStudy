import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Menu, X } from 'lucide-react'

export function LandingNav() {
  const { t } = useTranslation('landing')
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200/60">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between py-4">
        <div className="flex items-center gap-2 sm:gap-3.5 min-w-0">
          <img src="/favicon.png" alt="" className="w-9 h-9 md:w-16 md:h-16 shrink-0 object-contain" />
          <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-14 md:h-16 hidden md:block" />
          <span className="font-extrabold text-gray-900 md:hidden text-lg tracking-tight truncate">ReeeeecallStudy</span>
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-3">
          <Link to="/content" className="text-sm text-gray-600 hover:text-gray-900 transition no-underline">
            {t('nav.blog', 'Insights')}
          </Link>
          <Link to="/auth/login" className="text-sm text-gray-600 hover:text-gray-900 transition no-underline">
            {t('nav.login', 'Log in')}
          </Link>
          <Link
            to="/auth/login"
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition no-underline"
          >
            {t('nav.start', 'Get Started')}
          </Link>
        </nav>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg cursor-pointer"
          aria-label="Menu"
        >
          {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white/95 backdrop-blur-md">
          <nav className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-1">
            <Link
              to="/content"
              onClick={() => setMenuOpen(false)}
              className="px-3 py-3 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition no-underline"
            >
              {t('nav.blog', 'Insights')}
            </Link>
            <Link
              to="/auth/login"
              onClick={() => setMenuOpen(false)}
              className="px-3 py-3 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition no-underline"
            >
              {t('nav.login', 'Log in')}
            </Link>
            <Link
              to="/auth/login"
              onClick={() => setMenuOpen(false)}
              className="mx-3 mt-1 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition no-underline text-center"
            >
              {t('nav.start', 'Get Started')}
            </Link>
          </nav>
        </div>
      )}
    </header>
  )
}
