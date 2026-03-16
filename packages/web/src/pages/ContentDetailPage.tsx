import { useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useContentStore } from '../stores/content-store'
import { useContentViewTracking } from '../hooks/useContentViewTracking'
import { BlockRenderer } from '../components/content/BlockRenderer'
import { ContentDetailSkeleton } from '../components/content/ContentDetailSkeleton'
import { ContentNav } from '../components/content/ContentNav'
import { SEOHead } from '../components/content/SEOHead'
import { FooterSection } from '../components/landing/FooterSection'
import { buildArticleJsonLd, buildBreadcrumbJsonLd, buildHreflangAlternates, buildLearningResourceJsonLd } from '../lib/content-seo'
import { SEO } from '../lib/seo-config'

export function ContentDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { t } = useTranslation('content')
  const {
    currentArticle, detailLoading, detailError, fetchContentBySlug,
    relatedArticles, fetchRelatedArticles,
  } = useContentStore()

  useContentViewTracking(currentArticle?.id)

  useEffect(() => {
    if (slug) {
      fetchContentBySlug(slug)
    }
  }, [slug, fetchContentBySlug])

  useEffect(() => {
    if (currentArticle?.slug && currentArticle?.tags?.length > 0) {
      fetchRelatedArticles(currentArticle.slug, currentArticle.tags)
    }
  }, [currentArticle?.slug, currentArticle?.tags, fetchRelatedArticles])

  if (detailLoading) {
    return (
      <div className="min-h-screen bg-white">
        <ContentNav
          backTo="/insight"
          backLabel={t('detail.backToList')}
        />
        <ContentDetailSkeleton />
      </div>
    )
  }

  if (detailError || !currentArticle) {
    return (
      <div className="min-h-screen bg-white">
        <SEOHead
          title={t('detail.notFound')}
          description=""
          noIndex
        />
        <ContentNav
          backTo="/insight"
          backLabel={t('detail.backToList')}
        />
        <div className="max-w-3xl mx-auto px-4 py-20 text-center">
          <p className="text-gray-400 text-lg">
            {t('detail.notFound')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      <SEOHead
        title={currentArticle.meta_title || currentArticle.title}
        description={currentArticle.meta_description || currentArticle.subtitle || ''}
        ogImage={currentArticle.og_image_url || currentArticle.thumbnail_url || SEO.DEFAULT_OG_IMAGE}
        ogType="article"
        canonicalUrl={currentArticle.canonical_url || `${SEO.SITE_URL}/insight/${currentArticle.slug}`}
        jsonLd={[
          buildArticleJsonLd(currentArticle, relatedArticles.map((r) => r.slug)),
          buildBreadcrumbJsonLd(currentArticle),
          buildLearningResourceJsonLd(currentArticle),
        ]}
        hreflangAlternates={buildHreflangAlternates(currentArticle.slug)}
        publishedTime={currentArticle.published_at}
        modifiedTime={currentArticle.updated_at}
        articleSection={currentArticle.tags?.[0]}
        keywords={currentArticle.tags}
        articleTags={currentArticle.tags}
        articleAuthor={currentArticle.author_name || SEO.AUTHOR_NAME}
      />
      <ContentNav
        backTo="/insight"
        backLabel={t('detail.backToList')}
      />

      <article className="max-w-3xl mx-auto px-4 py-10 sm:py-16" data-speakable>
        <BlockRenderer blocks={currentArticle.content_blocks} />
      </article>

      {relatedArticles.length > 0 && (
        <section className="max-w-3xl mx-auto px-4 pb-12">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {t('detail.relatedArticles', { defaultValue: 'Related Articles' })}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {relatedArticles.map((item) => (
              <Link
                key={item.id}
                to={`/insight/${item.slug}`}
                className="group block p-4 rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <h3 className="text-sm font-medium text-gray-900 group-hover:text-blue-600 line-clamp-2">
                  {item.title}
                </h3>
                {item.subtitle && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.subtitle}</p>
                )}
                <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
                  {item.reading_time_minutes && <span>{item.reading_time_minutes} min</span>}
                  {item.tags?.slice(0, 2).map((tag) => (
                    <span key={tag} className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded text-[10px]">
                      {tag}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <FooterSection />
    </div>
  )
}
