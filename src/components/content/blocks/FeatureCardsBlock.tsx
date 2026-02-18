import type { FeatureCardsBlock as FeatureCardsBlockType } from '../../../types/content-blocks'
import { CONTENT_ICON_MAP } from '../../../lib/content-blocks'

const COLOR_MAP: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-green-50 text-green-700',
  purple: 'bg-purple-50 text-purple-700',
  orange: 'bg-orange-50 text-orange-700',
  pink: 'bg-pink-50 text-pink-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  indigo: 'bg-indigo-50 text-indigo-700',
}

const ICON_COLOR_MAP: Record<string, string> = {
  blue: 'text-blue-600',
  green: 'text-green-600',
  purple: 'text-purple-600',
  orange: 'text-orange-600',
  pink: 'text-pink-600',
  amber: 'text-amber-600',
  red: 'text-red-600',
  indigo: 'text-indigo-600',
}

export function FeatureCardsBlock({ props }: { props: FeatureCardsBlockType['props'] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-8">
      {props.items.map((item, i) => {
        const Icon = CONTENT_ICON_MAP[item.icon]
        const bgColor = COLOR_MAP[item.color] || COLOR_MAP.blue
        const iconColor = ICON_COLOR_MAP[item.color] || ICON_COLOR_MAP.blue

        return (
          <div key={i} className={`rounded-xl p-5 ${bgColor}`}>
            {Icon && <Icon className={`w-8 h-8 mb-3 ${iconColor}`} />}
            <h4 className="font-bold mb-1">{item.title}</h4>
            <p className="text-sm opacity-80">{item.description}</p>
          </div>
        )
      })}
    </div>
  )
}
