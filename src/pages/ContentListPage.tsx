import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen } from 'lucide-react'
import { useContentStore } from '../stores/content-store'
import { useInfiniteScroll } from '../hooks/useInfiniteScroll'
import { ContentCard } from '../components/content/ContentCard'
import { ContentSkeleton } from '../components/content/ContentSkeleton'
import { ContentNav } from '../components/content/ContentNav'
import { SEOHead } from '../components/content/SEOHead'
import { buildCollectionPageJsonLd, buildOrganizationJsonLd, buildStaticHreflangAlternates } from '../lib/content-seo'
import { SEO } from '../lib/seo-config'

export function ContentListPage() {
  const { t, i18n } = useTranslation('content')
  const { items, hasMore, listLoading, fetchContents } = useContentStore()

  const { sentinelRef } = useInfiniteScroll({
    onLoadMore: () => fetchContents(false),
    hasMore,
    loading: listLoading,
  })

  useEffect(() => {
    fetchContents(true)
  }, [fetchContents, i18n.language])

  return (
    <div className="min-h-screen bg-white">
      <SEOHead
        title={t('seo.listTitle')}
        description={t('seo.listDescription')}
        ogImage={SEO.DEFAULT_OG_IMAGE}
        ogType="website"
        canonicalUrl={`${SEO.SITE_URL}/content`}
        jsonLd={[buildCollectionPageJsonLd(), buildOrganizationJsonLd()]}
        keywords={['spaced repetition', 'learning strategies', 'study tips', 'flashcards', 'active recall', 'memory techniques']}
        hreflangAlternates={buildStaticHreflangAlternates('/content')}
      />
      <ContentNav backTo="/landing" />

      <main className="max-w-7xl mx-auto px-4 py-10 sm:py-16">
        <div className="text-center mb-10 sm:mb-14 pb-12">
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold text-gray-900 mb-3">
            {t('list.title')}
          </h1>
          <p className="text-gray-500 text-base sm:text-lg">
            {t('list.subtitle')}
          </p>
        </div>

        {/* Initial loading */}
        {listLoading && items.length === 0 && <ContentSkeleton />}

        {/* Empty state */}
        {!listLoading && items.length === 0 && (
          <div className="text-center py-20">
            <BookOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-400 text-lg">{t('list.noArticles')}</p>
          </div>
        )}

        {/* Masonry grid */}
        {items.length > 0 && (
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-5">
            {items.map((item) => (
              <div key={item.id} className="break-inside-avoid mb-5">
                <ContentCard content={item} />
              </div>
            ))}
          </div>
        )}

        {/* Load more sentinel */}
        <div ref={sentinelRef} className="py-8 text-center">
          {listLoading && items.length > 0 && (
            <div className="flex items-center justify-center gap-2 text-gray-400">
              <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
              <span className="text-sm">{t('list.loadingMore')}</span>
            </div>
          )}
          {!hasMore && items.length > 0 && (
            <p className="text-sm text-gray-400">{t('list.reachedEnd')}</p>
          )}
        </div>
      </main>
    </div>
  )
}
