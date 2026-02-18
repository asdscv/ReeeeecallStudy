import type { FeatureCardsBlock as FeatureCardsBlockType } from '../../../types/content-blocks'
import { parseInlineMarkdown } from '../../../lib/content-blocks'

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

export function FeatureCardsBlock({ props }: { props: FeatureCardsBlockType['props'] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-8">
      {props.items.map((item, i) => {
        const bgColor = COLOR_MAP[item.color] || COLOR_MAP.blue

        return (
          <div key={i} className={`rounded-xl p-5 h-full flex flex-col justify-center ${bgColor}`}>
            <h4 className="font-bold mb-1">{item.title}</h4>
            <p className="text-sm opacity-80">{parseInlineMarkdown(item.description)}</p>
          </div>
        )
      })}
    </div>
  )
}
