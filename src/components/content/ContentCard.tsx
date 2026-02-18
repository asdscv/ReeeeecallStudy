import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import type { ContentListItem } from '../../types/content-blocks'

interface ContentCardProps {
  content: ContentListItem
}

export function ContentCard({ content }: ContentCardProps) {
  const { t } = useTranslation('content')

  return (
    <Link
      to={`/content/${content.slug}`}
      className="block group rounded-xl overflow-hidden bg-white border border-gray-200 hover:shadow-lg transition-all duration-300 hover:scale-[1.02] no-underline"
    >
      {content.thumbnail_url ? (
        <div className="relative">
          <img
            src={content.thumbnail_url}
            alt={content.title}
            className="w-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <h3 className="text-lg font-bold text-white leading-snug">{content.title}</h3>
          </div>
        </div>
      ) : (
        <div className="p-5">
          <h3 className="text-lg font-bold text-gray-900 leading-snug group-hover:text-blue-600 transition-colors">
            {content.title}
          </h3>
        </div>
      )}

      <div className="px-4 pb-4 pt-2">
        {content.subtitle && (
          <p className="text-sm text-gray-500 line-clamp-2 mb-3">{content.subtitle}</p>
        )}
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {t('list.readingTime', { minutes: content.reading_time_minutes })}
          </span>
          <time dateTime={content.published_at}>
            {new Date(content.published_at).toLocaleDateString()}
          </time>
        </div>
        {content.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {content.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-full">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}
