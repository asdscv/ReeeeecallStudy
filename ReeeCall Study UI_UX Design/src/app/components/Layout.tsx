import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router';
import { BarChart3, BookOpen, FileText, Settings as SettingsIcon, LogOut } from 'lucide-react';
import { getCurrentUser, logout } from '../lib/storage';

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [userName, setUserName] = useState('');

  useEffect(() => {
    getUserName();
  }, []);

  function getUserName() {
    const user = getCurrentUser();
    if (user?.name) {
      setUserName(user.name);
    }
  }

  function handleLogout() {
    logout();
    navigate('/auth/login');
  }

  const navItems = [
    { path: '/', label: '대시보드', icon: BarChart3 },
    { path: '/decks', label: '덱', icon: BookOpen },
    { path: '/templates', label: '템플릿', icon: FileText },
    { path: '/settings', label: '설정', icon: SettingsIcon },
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 h-14">
        <div className="max-w-6xl mx-auto px-4 h-full flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="text-lg font-bold text-gray-900">
            ReeeCall Study
          </Link>

          {/* Navigation */}
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                    active
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden md:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* User Info */}
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500 hidden sm:inline">{userName}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
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
  );
}