import type { ImageBlock as ImageBlockType } from '../../../types/content-blocks'
import { stripMarkdownText } from '../../../lib/content-blocks'

export function ImageBlock({ props }: { props: ImageBlockType['props'] }) {
  return (
    <figure className="my-8">
      <img
        src={props.src}
        alt={props.alt}
        className="w-full rounded-xl"
        loading="lazy"
      />
      {props.caption && (
        <figcaption className="mt-2 text-center text-sm text-gray-500">
          {stripMarkdownText(props.caption)}
        </figcaption>
      )}
    </figure>
  )
}
