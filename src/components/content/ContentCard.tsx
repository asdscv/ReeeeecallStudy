import { Link } from 'react-router-dom'
import type { ContentListItem } from '../../types/content-blocks'

interface ContentCardProps {
  content: ContentListItem
}

const heights = [280, 320, 350, 380, 400, 420]

export function ContentCard({ content }: ContentCardProps) {
  const heightIndex = content.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % heights.length
  const cardHeight = heights[heightIndex]

  return (
    <Link
      to={`/content/${content.slug}`}
      className="block group rounded-2xl overflow-hidden no-underline transition-transform duration-300 hover:scale-[0.98]"
      style={{ height: cardHeight }}
    >
      {content.thumbnail_url ? (
        <div className="relative w-full h-full">
          <img
            src={content.thumbnail_url}
            alt={content.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-5">
            <h3 className="text-2xl md:text-3xl font-bold text-white leading-snug">
              {content.title}
            </h3>
          </div>
        </div>
      ) : (
        <div className="relative w-full h-full bg-gradient-to-br from-blue-600 to-blue-800">
          <div className="absolute bottom-0 left-0 right-0 p-5">
            <h3 className="text-2xl md:text-3xl font-bold text-white leading-snug">
              {content.title}
            </h3>
          </div>
        </div>
      )}
    </Link>
  )
}
