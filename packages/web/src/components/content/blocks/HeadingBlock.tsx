import type { HeadingBlock as HeadingBlockType } from '../../../types/content-blocks'
import { stripMarkdownText } from '../../../lib/content-blocks'

export function HeadingBlock({ props }: { props: HeadingBlockType['props'] }) {
  const Tag = props.level === 2 ? 'h2' : 'h3'
  const sizeClass = props.level === 2
    ? 'text-2xl sm:text-3xl font-extrabold text-foreground'
    : 'text-xl sm:text-2xl font-bold text-foreground'

  return (
    <div className="mt-10 mb-6">
      {props.accent !== false && props.level === 2 && (
        <div className="w-12 h-1 bg-brand rounded-full mb-3" />
      )}
      <Tag className={sizeClass}>{stripMarkdownText(props.text)}</Tag>
    </div>
  )
}
