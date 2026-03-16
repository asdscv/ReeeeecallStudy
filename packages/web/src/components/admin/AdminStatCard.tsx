import { formatStatNumber } from '../../lib/admin-stats'

const COLOR_MAP = {
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-green-50 text-green-700',
  purple: 'bg-purple-50 text-purple-700',
  orange: 'bg-orange-50 text-orange-700',
  pink: 'bg-pink-50 text-pink-700',
  gray: 'bg-gray-50 text-gray-700',
  teal: 'bg-teal-50 text-teal-700',
  yellow: 'bg-yellow-50 text-yellow-700',
  red: 'bg-red-50 text-red-700',
} as const

type StatCardColor = keyof typeof COLOR_MAP

interface AdminStatCardProps {
  label: string
  value: string | number
  icon?: string
  color?: StatCardColor
  subtitle?: string
  trend?: { value: number; direction: 'up' | 'down' | 'flat' }
  size?: 'default' | 'lg'
}

export function AdminStatCard({ label, value, icon, color = 'blue', subtitle, trend, size = 'default' }: AdminStatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-3">
        {icon && (
          <div
            className={`${size === 'lg' ? 'w-12 h-12 text-xl' : 'w-10 h-10 text-lg'} rounded-lg flex items-center justify-center ${COLOR_MAP[color] ?? COLOR_MAP.blue}`}
            aria-hidden="true"
          >
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-500 truncate">{label}</p>
          <div className="flex items-baseline gap-2">
            <p className={`${size === 'lg' ? 'text-xl' : 'text-lg'} font-semibold text-gray-900 truncate`}>
              {formatStatNumber(value)}
            </p>
            {trend && trend.direction !== 'flat' && (
              <span className={`text-xs font-medium ${trend.direction === 'up' ? 'text-green-600' : 'text-red-500'}`}>
                {trend.direction === 'up' ? '\u2191' : '\u2193'} {Math.abs(trend.value)}%
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-[11px] text-gray-400 truncate mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
    </div>
  )
}
