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
}

export function AdminStatCard({ label, value, icon, color = 'blue' }: AdminStatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-3">
        {icon && (
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg ${COLOR_MAP[color] ?? COLOR_MAP.blue}`}
            aria-hidden="true"
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs text-gray-500 truncate">{label}</p>
          <p className="text-lg font-semibold text-gray-900 truncate">
            {formatStatNumber(value)}
          </p>
        </div>
      </div>
    </div>
  )
}
