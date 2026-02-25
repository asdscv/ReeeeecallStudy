import type { NumberedListBlock as NumberedListBlockType } from '../../../types/content-blocks'
import { parseInlineMarkdown, stripMarkdownText } from '../../../lib/content-blocks'

export function NumberedListBlock({ props }: { props: NumberedListBlockType['props'] }) {
  return (
    <ol className="space-y-4 my-8">
      {props.items.map((item, i) => (
        <li key={i} className="flex gap-4">
          <span className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center">
            {i + 1}
          </span>
          <div>
            <h4 className="text-lg font-bold text-gray-900">{stripMarkdownText(item.heading)}</h4>
            <p className="text-gray-600 mt-1">{parseInlineMarkdown(item.description)}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
