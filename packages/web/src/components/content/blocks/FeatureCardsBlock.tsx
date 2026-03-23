import type { FeatureCardsBlock as FeatureCardsBlockType } from '../../../types/content-blocks'
import { parseInlineMarkdown, stripMarkdownText } from '../../../lib/content-blocks'

const COLOR_MAP: Record<string, string> = {
  blue: 'bg-brand/10 text-brand',
  green: 'bg-success/10 text-success',
  purple: 'bg-purple-50 text-purple-700',
  orange: 'bg-orange-50 text-orange-700',
  pink: 'bg-pink-50 text-pink-700',
  amber: 'bg-warning/10 text-warning',
  red: 'bg-destructive/10 text-destructive',
  indigo: 'bg-indigo-50 text-indigo-700',
}

export function FeatureCardsBlock({ props }: { props: FeatureCardsBlockType['props'] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-8">
      {props.items.map((item, i) => {
        const bgColor = COLOR_MAP[item.color] || COLOR_MAP.blue

        return (
          <div key={i} className={`rounded-xl p-5 h-full flex flex-col justify-center ${bgColor}`}>
            <h4 className="font-bold mb-1">{stripMarkdownText(item.title)}</h4>
            <p className="text-sm opacity-80">{parseInlineMarkdown(item.description)}</p>
          </div>
        )
      })}
    </div>
  )
}
