import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Menu, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useScrollspy } from '../../hooks/useScrollspy'
import { useAuthStore } from '../../stores/auth-store'

const SECTION_IDS = ['features', 'stats', 'social-proof', 'how-it-works', 'faq']

const NAV_ITEMS = [
  { id: 'features', key: 'nav.features', fallback: 'Features' },
  { id: 'stats', key: 'nav.results', fallback: 'Results' },
  { id: 'social-proof', key: 'nav.reviews', fallback: 'Reviews' },
  { id: 'how-it-works', key: 'nav.howItWorks', fallback: 'How It Works' },
  { id: 'faq', key: 'nav.faq', fallback: 'FAQ' },
]

export function LandingNav() {
  const { t } = useTranslation('landing')
  const { user } = useAuthStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  const sectionIds = useMemo(() => SECTION_IDS, [])
  const activeId = useScrollspy(sectionIds)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
    setMenuOpen(false)
  }

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 border-b ${
        scrolled
          ? 'bg-card/95 shadow-sm backdrop-blur-md border-border/60'
          : 'bg-card/80 backdrop-blur-md border-border/60'
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between py-3 sm:py-4">
        <div className="flex items-center gap-2 sm:gap-3.5 min-w-0">
          <img src="/favicon.png" alt="" className="w-9 h-9 md:w-16 md:h-16 shrink-0 object-contain" />
          <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-14 md:h-16 hidden md:block" />
          <span className="font-extrabold text-foreground md:hidden text-lg tracking-tight truncate">ReeeeecallStudy</span>
        </div>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => scrollTo(item.id)}
              className="relative px-3 py-2 text-sm transition-colors cursor-pointer bg-transparent border-none"
            >
              <span
                className={`${
                  activeId === item.id
                    ? 'text-brand font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                } transition-colors`}
              >
                {t(item.key, item.fallback)}
              </span>
              {activeId === item.id && (
                <motion.div
                  layoutId="nav-underline"
                  className="absolute bottom-0 left-3 right-3 h-0.5 bg-brand rounded-full"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          ))}

          <div className="w-px h-5 bg-accent mx-2" />

          <Link to="/insight" className="text-sm text-muted-foreground hover:text-foreground transition px-3 py-2 no-underline">
            {t('nav.blog', 'Insights')}
          </Link>
          {user ? (
            <Link
              to="/dashboard"
              className="px-4 py-2 bg-brand text-white text-sm font-semibold rounded-lg hover:bg-brand transition no-underline ml-1"
            >
              {t('nav.dashboard', 'Dashboard')}
            </Link>
          ) : (
            <>
              <Link to="/auth/login" className="text-sm text-muted-foreground hover:text-foreground transition px-3 py-2 no-underline">
                {t('nav.login', 'Log in')}
              </Link>
              <Link
                to="/auth/login"
                className="px-4 py-2 bg-brand text-white text-sm font-semibold rounded-lg hover:bg-brand transition no-underline ml-1"
              >
                {t('nav.start', 'Get Started')}
              </Link>
            </>
          )}
        </nav>

        {/* Tablet/small desktop nav - show only action buttons */}
        <nav className="hidden md:flex lg:hidden items-center gap-3">
          <Link to="/insight" className="text-sm text-muted-foreground hover:text-foreground transition no-underline">
            {t('nav.blog', 'Insights')}
          </Link>
          {user ? (
            <Link
              to="/dashboard"
              className="px-4 py-2 bg-brand text-white text-sm font-semibold rounded-lg hover:bg-brand transition no-underline"
            >
              {t('nav.dashboard', 'Dashboard')}
            </Link>
          ) : (
            <>
              <Link to="/auth/login" className="text-sm text-muted-foreground hover:text-foreground transition no-underline">
                {t('nav.login', 'Log in')}
              </Link>
              <Link
                to="/auth/login"
                className="px-4 py-2 bg-brand text-white text-sm font-semibold rounded-lg hover:bg-brand transition no-underline"
              >
                {t('nav.start', 'Get Started')}
              </Link>
            </>
          )}
        </nav>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden p-2 text-muted-foreground hover:bg-accent rounded-lg cursor-pointer"
          aria-label="Menu"
        >
          {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-border bg-card/95 backdrop-blur-md">
          <nav className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollTo(item.id)}
                className={`px-3 py-3 text-sm rounded-lg transition text-left cursor-pointer bg-transparent border-none ${
                  activeId === item.id
                    ? 'text-brand font-semibold bg-brand/10'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                {t(item.key, item.fallback)}
              </button>
            ))}
            <div className="h-px bg-accent my-1" />
            <Link
              to="/insight"
              onClick={() => setMenuOpen(false)}
              className="px-3 py-3 text-sm text-muted-foreground hover:bg-accent rounded-lg transition no-underline"
            >
              {t('nav.blog', 'Insights')}
            </Link>
            {user ? (
              <Link
                to="/dashboard"
                onClick={() => setMenuOpen(false)}
                className="mx-3 mt-1 px-4 py-2.5 bg-brand text-white text-sm font-semibold rounded-lg hover:bg-brand transition no-underline text-center"
              >
                {t('nav.dashboard', 'Dashboard')}
              </Link>
            ) : (
              <>
                <Link
                  to="/auth/login"
                  onClick={() => setMenuOpen(false)}
                  className="px-3 py-3 text-sm text-muted-foreground hover:bg-accent rounded-lg transition no-underline"
                >
                  {t('nav.login', 'Log in')}
                </Link>
                <Link
                  to="/auth/login"
                  onClick={() => setMenuOpen(false)}
                  className="mx-3 mt-1 px-4 py-2.5 bg-brand text-white text-sm font-semibold rounded-lg hover:bg-brand transition no-underline text-center"
                >
                  {t('nav.start', 'Get Started')}
                </Link>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  )
}
