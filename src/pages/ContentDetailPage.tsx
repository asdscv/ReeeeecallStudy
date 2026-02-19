import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useContentStore } from '../stores/content-store'
import { useContentViewTracking } from '../hooks/useContentViewTracking'
import { BlockRenderer } from '../components/content/BlockRenderer'
import { ContentDetailSkeleton } from '../components/content/ContentDetailSkeleton'
import { ContentNav } from '../components/content/ContentNav'
import { SEOHead } from '../components/content/SEOHead'
import { buildArticleJsonLd, buildBreadcrumbJsonLd, buildHreflangAlternates, buildLearningResourceJsonLd } from '../lib/content-seo'
import { SEO } from '../lib/seo-config'

export function ContentDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { t } = useTranslation('content')
  const { currentArticle, detailLoading, detailError, fetchContentBySlug } = useContentStore()

  useContentViewTracking(currentArticle?.id)

  useEffect(() => {
    if (slug) {
      fetchContentBySlug(slug)
    }
  }, [slug, fetchContentBySlug])

  if (detailLoading) {
    return (
      <div className="min-h-screen bg-white">
        <ContentNav
          backTo="/content"
          backLabel={t('detail.backToList')}
        />
        <ContentDetailSkeleton />
      </div>
    )
  }

  if (detailError || !currentArticle) {
    return (
      <div className="min-h-screen bg-white">
        <ContentNav
          backTo="/content"
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
        canonicalUrl={currentArticle.canonical_url || `${SEO.SITE_URL}/content/${currentArticle.slug}`}
        jsonLd={[
          buildArticleJsonLd(currentArticle),
          buildBreadcrumbJsonLd(currentArticle),
          buildLearningResourceJsonLd(currentArticle),
        ]}
        hreflangAlternates={buildHreflangAlternates(currentArticle.slug)}
        publishedTime={currentArticle.published_at}
        modifiedTime={currentArticle.updated_at}
        articleSection={currentArticle.tags?.[0]}
        keywords={currentArticle.tags}
        articleTags={currentArticle.tags}
      />
      <ContentNav
        backTo="/content"
        backLabel={t('detail.backToList')}
      />

      <article className="max-w-3xl mx-auto px-4 py-10 sm:py-16" data-speakable>
        <BlockRenderer blocks={currentArticle.content_blocks} />
      </article>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 py-10 sm:py-12">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <img src="/favicon.png" alt="" className="w-7 h-7" />
              <span className="font-bold text-gray-900">ReeeeecallStudy</span>
            </div>
            <p className="text-sm text-gray-400">
              {t('landing:footer.copyright')}
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
