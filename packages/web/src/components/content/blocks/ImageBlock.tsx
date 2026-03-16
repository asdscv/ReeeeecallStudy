import type { ImageBlock as ImageBlockType } from '../../../types/content-blocks'
import { stripMarkdownText } from '../../../lib/content-blocks'

export function ImageBlock({ props, index }: { props: ImageBlockType['props']; index?: number }) {
  return (
    <figure className="my-8">
      <img
        src={props.src}
        alt={props.alt}
        className="w-full rounded-xl"
        loading={index !== undefined && index < 2 ? 'eager' : 'lazy'}
        decoding={index !== undefined && index < 2 ? 'sync' : 'async'}
        fetchPriority={index !== undefined && index < 2 ? 'high' : undefined}
      />
      {props.caption && (
        <figcaption className="mt-2 text-center text-sm text-gray-500">
          {stripMarkdownText(props.caption)}
        </figcaption>
      )}
    </figure>
  )
}
