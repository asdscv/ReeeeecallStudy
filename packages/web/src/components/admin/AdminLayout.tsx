import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

const TABS = [
  { key: 'overview', path: '/admin', end: true },
  { key: 'users', path: '/admin/users', end: false },
  { key: 'study', path: '/admin/study', end: false },
  { key: 'market', path: '/admin/market', end: false },
  { key: 'official', path: '/admin/official', end: false },
  { key: 'contents', path: '/admin/contents', end: false },
  { key: 'system', path: '/admin/system', end: false },
  { key: 'audit', path: '/admin/audit', end: false },
] as const

export function AdminLayout() {
  const { t } = useTranslation('admin')

  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-3">
          {t('title')}
        </h1>
        <nav className="flex gap-1 overflow-x-auto border-b border-border -mx-4 px-4 sm:mx-0 sm:px-0">
          {TABS.map(({ key, path, end }) => (
            <NavLink
              key={key}
              to={path}
              end={end}
              className={({ isActive }) =>
                `px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition no-underline ${
                  isActive
                    ? 'border-brand text-brand'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`
              }
            >
              {t(`tabs.${key}`)}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  )
}
