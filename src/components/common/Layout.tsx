import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../stores/auth-store'

const navItems = [
  { path: '/', label: '대시보드', icon: '📊' },
  { path: '/decks', label: '덱 관리', icon: '📚' },
  { path: '/templates', label: '템플릿', icon: '📋' },
  { path: '/settings', label: '설정', icon: '⚙️' },
]

export function Layout() {
  const { user, signOut } = useAuthStore()
  const location = useLocation()

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="text-lg font-bold text-gray-900 no-underline">
            ReeeCall Study
          </Link>

          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`px-3 py-2 rounded-lg text-sm no-underline transition ${
                  location.pathname === item.path
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span className="mr-1">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{user?.email}</span>
            <button
              onClick={signOut}
              className="text-sm text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
