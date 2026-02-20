import { useState, useRef, useEffect } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { Menu, X, ChevronDown, BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../stores/auth-store'

type NavLink = { kind: 'link'; path: string; label: string; icon: string }
type NavGroup = { kind: 'group'; label: string; icon: string; children: { path: string; label: string; icon: string }[] }
type NavItem = NavLink | NavGroup

export function Layout() {
  const { t } = useTranslation('common')
  const { signOut, role } = useAuthStore()

  const navItems: NavItem[] = [
    { kind: 'link', path: '/quick-study', label: t('nav.quickStudy'), icon: '⚡' },
    { kind: 'link', path: '/', label: t('nav.dashboard'), icon: '📊' },
    { kind: 'group', label: t('nav.study'), icon: '📚', children: [
      { path: '/decks', label: t('nav.decks'), icon: '📚' },
      { path: '/templates', label: t('nav.cards'), icon: '📋' },
      { path: '/marketplace', label: t('nav.marketplace'), icon: '🏪' },
      { path: '/history', label: t('nav.studyHistory'), icon: '📝' },
    ]},
    { kind: 'link', path: '/settings', label: t('nav.settings'), icon: '⚙️' },
    ...(role === 'admin' ? [{ kind: 'link' as const, path: '/admin', label: t('nav.admin'), icon: '🛡️' }] : []),
  ]
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [openDesktopGroup, setOpenDesktopGroup] = useState<string | null>(null)
  const [openMobileGroups, setOpenMobileGroups] = useState<Set<string>>(new Set())
  const desktopNavRef = useRef<HTMLElement>(null)

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  const isGroupActive = (group: NavGroup) =>
    group.children.some(child => isActive(child.path))

  // 클릭 외부 감지로 데스크톱 드롭다운 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (desktopNavRef.current && !desktopNavRef.current.contains(e.target as Node)) {
        setOpenDesktopGroup(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggleDesktopGroup = (label: string) => {
    setOpenDesktopGroup(prev => prev === label ? null : label)
  }

  const toggleMobileGroup = (label: string) => {
    setOpenMobileGroups(prev => {
      const next = new Set(prev)
      if (next.has(label)) {
        next.delete(label)
      } else {
        next.add(label)
      }
      return next
    })
  }

  const activeClass = 'bg-blue-50 text-blue-700 font-medium'
  const inactiveClass = 'text-gray-600 hover:bg-gray-100'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="shrink-0 no-underline flex items-center gap-2">
            <img src="/favicon.png" alt="" className="w-9 h-9 sm:w-10 sm:h-10 object-contain" />
            <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-8 sm:h-11 object-contain" />
          </Link>

          {/* Desktop nav */}
          <nav ref={desktopNavRef} className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              if (item.kind === 'link') {
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`px-3 py-2 rounded-lg text-sm no-underline transition ${
                      isActive(item.path) ? activeClass : inactiveClass
                    }`}
                  >
                    <span className="mr-1">{item.icon}</span>
                    {item.label}
                  </Link>
                )
              }

              // kind === 'group'
              const isOpen = openDesktopGroup === item.label
              return (
                <div key={item.label} className="relative">
                  <button
                    onClick={() => toggleDesktopGroup(item.label)}
                    className={`px-3 py-2 rounded-lg text-sm transition flex items-center gap-1 cursor-pointer border-none bg-transparent ${
                      isGroupActive(item) ? activeClass : inactiveClass
                    }`}
                  >
                    <span className="mr-1">{item.icon}</span>
                    {item.label}
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen && (
                    <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px] z-50">
                      {item.children.map((child) => (
                        <Link
                          key={child.path}
                          to={child.path}
                          onClick={() => setOpenDesktopGroup(null)}
                          className={`block px-4 py-2 text-sm no-underline transition ${
                            isActive(child.path) ? activeClass : inactiveClass
                          }`}
                        >
                          <span className="mr-2">{child.icon}</span>
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link to="/guide" className="hidden md:inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm no-underline transition text-gray-600 hover:bg-gray-100">
              <BookOpen className="w-4 h-4" />
              {t('nav.guide')}
            </Link>
            <button
              onClick={signOut}
              className="hidden md:inline text-sm text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              {t('actions.logout')}
            </button>

            {/* Mobile hamburger */}
            <button
              aria-label={t('menu')}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white">
            <nav className="max-w-6xl mx-auto px-4 py-2 flex flex-col">
              {navItems.map((item) => {
                if (item.kind === 'link') {
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`px-3 py-3 rounded-lg text-sm no-underline transition ${
                        isActive(item.path) ? activeClass : inactiveClass
                      }`}
                    >
                      <span className="mr-2">{item.icon}</span>
                      {item.label}
                    </Link>
                  )
                }

                // kind === 'group'
                const isOpen = openMobileGroups.has(item.label)
                return (
                  <div key={item.label}>
                    <button
                      onClick={() => toggleMobileGroup(item.label)}
                      className={`w-full px-3 py-3 rounded-lg text-sm transition flex items-center justify-between cursor-pointer border-none bg-transparent text-left ${
                        isGroupActive(item) ? activeClass : inactiveClass
                      }`}
                    >
                      <span>
                        <span className="mr-2">{item.icon}</span>
                        {item.label}
                      </span>
                      <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <div className="pl-6">
                        {item.children.map((child) => (
                          <Link
                            key={child.path}
                            to={child.path}
                            onClick={() => setMobileMenuOpen(false)}
                            className={`block px-3 py-2 rounded-lg text-sm no-underline transition ${
                              isActive(child.path) ? activeClass : inactiveClass
                            }`}
                          >
                            <span className="mr-2">{child.icon}</span>
                            {child.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              <div className="border-t border-gray-100 mt-2 pt-2 px-3 py-3 flex items-center justify-between">
                <Link
                  to="/guide"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-blue-600 no-underline transition"
                >
                  <BookOpen className="w-4 h-4" />
                  {t('nav.guide')}
                </Link>
                <button
                  onClick={() => { setMobileMenuOpen(false); signOut() }}
                  className="text-sm text-red-500 hover:text-red-600 cursor-pointer shrink-0 ml-4"
                >
                  {t('actions.logout')}
                </button>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-4 sm:py-6">
        <Outlet />
      </main>
    </div>
  )
}
