import type { ParagraphBlock as ParagraphBlockType } from '../../../types/content-blocks'
import { parseInlineMarkdown } from '../../../lib/content-blocks'

export function ParagraphBlock({ props }: { props: ParagraphBlockType['props'] }) {
  return (
    <p className="text-base sm:text-lg text-gray-700 leading-relaxed mb-6">
      {parseInlineMarkdown(props.text)}
    </p>
  )
}
