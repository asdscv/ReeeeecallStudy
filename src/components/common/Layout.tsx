import { useState } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { useAuthStore } from '../../stores/auth-store'

const navItems = [
  { path: '/quick-study', label: '빠른 학습', icon: '⚡' },
  { path: '/', label: '대시보드', icon: '📊' },
  { path: '/history', label: '학습 기록', icon: '📝' },
  { path: '/decks', label: '덱', icon: '📚' },
  { path: '/templates', label: '카드', icon: '📋' },
  { path: '/settings', label: '설정', icon: '⚙️' },
]

export function Layout() {
  const { user, signOut } = useAuthStore()
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="shrink-0 no-underline flex items-center gap-2">
            <img src="/favicon.png" alt="" className="w-9 h-9" />
            <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-10 hidden sm:block" />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`px-3 py-2 rounded-lg text-sm no-underline transition ${
                  isActive(item.path)
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span className="mr-1">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden sm:inline text-sm text-gray-500 truncate max-w-[160px]">
              {user?.email}
            </span>
            <button
              onClick={signOut}
              className="hidden md:inline text-sm text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              로그아웃
            </button>

            {/* Mobile hamburger */}
            <button
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
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`px-3 py-3 rounded-lg text-sm no-underline transition ${
                    isActive(item.path)
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span className="mr-2">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
              <div className="border-t border-gray-100 mt-2 pt-2 px-3 py-3 flex items-center justify-between">
                <span className="text-sm text-gray-500 truncate">{user?.email}</span>
                <button
                  onClick={() => { setMobileMenuOpen(false); signOut() }}
                  className="text-sm text-red-500 hover:text-red-600 cursor-pointer shrink-0 ml-4"
                >
                  로그아웃
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
