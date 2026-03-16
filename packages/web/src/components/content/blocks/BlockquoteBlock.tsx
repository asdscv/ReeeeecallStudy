import type { BlockquoteBlock as BlockquoteBlockType } from '../../../types/content-blocks'
import { stripMarkdownText } from '../../../lib/content-blocks'

export function BlockquoteBlock({ props }: { props: BlockquoteBlockType['props'] }) {
  return (
    <blockquote className="border-l-4 border-blue-500 pl-6 py-2 my-8">
      <p className="text-xl italic text-gray-800 leading-relaxed">{stripMarkdownText(props.text)}</p>
      {props.attribution && (
        <footer className="mt-2 text-sm text-gray-500">— {stripMarkdownText(props.attribution)}</footer>
      )}
    </blockquote>
  )
}
