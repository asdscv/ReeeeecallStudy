// Content detail page bot handler — extracted from worker.js handleContentDetailBot
import {
  SITE_URL, BRAND_NAME, DEFAULT_OG_IMAGE,
  LIST_TITLES,
} from '../constants.js'
import {
  escapeHtml, buildHreflangTags,
  getSupabaseRestUrl, getSupabaseAnonKey,
  localizedUrl,
} from '../helpers.js'
import {
  buildArticleJsonLd,
  buildBreadcrumbJsonLd,
  buildLearningResourceJsonLd,
  buildOrganizationJsonLd,
} from '../json-ld.js'
import { renderBlocksToHtml } from '../content-renderer.js'
import { buildHtmlDocument, buildMetaTags, buildSeoResponse } from '../html-builder.js'

export async function handleContentDetailBot(slug, url, env) {
  const restUrl = getSupabaseRestUrl(env)
  const anonKey = getSupabaseAnonKey(env)
  const lang = url.searchParams.get('lang') || 'en'

  // Try requested locale first, fallback to any locale for this slug
  let res = await fetch(
    `${restUrl}/contents?slug=eq.${encodeURIComponent(slug)}&is_published=eq.true&locale=eq.${lang}&limit=1`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
  )
  let data = await res.json()
  let article = data?.[0]

  if (!article) {
    // Fallback: try without locale filter
    res = await fetch(
      `${restUrl}/contents?slug=eq.${encodeURIComponent(slug)}&is_published=eq.true&limit=1`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
    )
    data = await res.json()
    article = data?.[0]
  }

  if (!article) return null

  // Fetch related articles (same locale, different slug, preferring shared tags)
  let relatedArticles = []
  try {
    const relatedRes = await fetch(
      `${restUrl}/contents?is_published=eq.true&locale=eq.${article.locale}&slug=neq.${encodeURIComponent(slug)}&select=slug,title,subtitle,tags,reading_time_minutes,published_at&order=published_at.desc&limit=20`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
    )
    const allRelated = (await relatedRes.json()) || []
    const articleTags = new Set(article.tags || [])
    // Score by tag overlap, pick top 5
    relatedArticles = allRelated
      .map((r) => ({ ...r, score: (r.tags || []).filter((t) => articleTags.has(t)).length }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
  } catch { /* ignore */ }

  const blocks = article.content_blocks || []
  const title = article.meta_title || article.title
  const description = article.meta_description || article.subtitle || ''
  const ogImage = article.og_image_url || article.thumbnail_url || DEFAULT_OG_IMAGE
  const tags = article.tags || []
  const articleSection = tags[0] || 'Education'
  const bodyHtml = renderBlocksToHtml(blocks)

  const canonicalUrl = localizedUrl(`/insight/${slug}`, article.locale)

  // Build JSON-LD schemas
  const articleJsonLd = buildArticleJsonLd(article, title, description, ogImage, tags, slug)
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: BRAND_NAME, url: SITE_URL },
    { name: LIST_TITLES[article.locale]?.split(' — ')[0] || 'Learning Insights', url: `${SITE_URL}/insight` },
    { name: article.title, url: canonicalUrl },
  ])
  const learningResourceJsonLd = buildLearningResourceJsonLd(article, title, description, ogImage, tags, slug)

  const metaTags = buildMetaTags({
    title,
    description,
    ogType: 'article',
    ogUrl: canonicalUrl,
    ogImage,
    locale: article.locale,
    canonical: canonicalUrl,
    keywords: tags.join(', '),
    articleMeta: {
      publishedTime: article.published_at,
      modifiedTime: article.updated_at,
      section: articleSection,
      author: article.author_name || BRAND_NAME,
      tags,
    },
  })

  const feedLinks = `<link rel="alternate" type="application/rss+xml" title="${BRAND_NAME} Learning Insights" href="${SITE_URL}/feed.xml${lang !== 'en' ? `?lang=${lang}` : ''}">`
  const hreflangTags = buildHreflangTags(`/insight/${escapeHtml(slug)}`, true)

  const jsonLdScripts = [articleJsonLd, breadcrumbJsonLd, learningResourceJsonLd, buildOrganizationJsonLd()]
    .map((schema) => `<script type="application/ld+json">${JSON.stringify(schema)}</script>`)
    .join('\n')

  const head = `${metaTags}
${feedLinks}
${hreflangTags}
${jsonLdScripts}`

  const body = `<nav aria-label="breadcrumb"><ol><li><a href="${SITE_URL}">${BRAND_NAME}</a></li><li><a href="${SITE_URL}/insight">${LIST_TITLES[article.locale]?.split(' — ')[0] || 'Learning Insights'}</a></li><li>${escapeHtml(article.title)}</li></ol></nav>
<article data-speakable>
<header>
<h1>${escapeHtml(article.title)}</h1>
${article.subtitle ? `<p>${escapeHtml(article.subtitle)}</p>` : ''}
<div>
${article.published_at ? `<time datetime="${escapeHtml(article.published_at)}">${new Date(article.published_at).toISOString().split('T')[0]}</time>` : ''}
<span>${escapeHtml(article.author_name || BRAND_NAME)}</span>
${article.reading_time_minutes ? `<span>${article.reading_time_minutes} min read</span>` : ''}
</div>
${tags.length > 0 ? `<div>${tags.map((t) => `<a href="${SITE_URL}/insight?tag=${encodeURIComponent(t)}" rel="tag">${escapeHtml(t)}</a>`).join(' ')}</div>` : ''}
</header>
<section>
${bodyHtml}
</section>
</article>
${relatedArticles.length > 0 ? `<aside>
<h2>${article.locale === 'ko' ? '관련 글' : 'Related Articles'}</h2>
<ul>
${relatedArticles.map((r) => {
  const rDate = r.published_at ? new Date(r.published_at).toISOString().split('T')[0] : ''
  return `<li><a href="${SITE_URL}/insight/${escapeHtml(r.slug)}">${escapeHtml(r.title)}</a>${r.subtitle ? ` — ${escapeHtml(r.subtitle)}` : ''}${rDate ? ` <time datetime="${r.published_at}">(${rDate})</time>` : ''}</li>`
}).join('\n')}
</ul>
</aside>` : ''}
<footer>
<p><a href="${SITE_URL}/insight">← ${article.locale === 'ko' ? '더 많은 학습 인사이트' : 'More Learning Insights'}</a></p>
<p><a href="${SITE_URL}/landing">${article.locale === 'ko' ? `${BRAND_NAME}에서 학습 시작하기` : `Start Learning with ${BRAND_NAME}`}</a></p>
</footer>`

  const html = buildHtmlDocument({ lang: article.locale, head, body })

  return buildSeoResponse(html, {
    lang: article.locale,
    cacheSeconds: 3600,
    robots: 'index, follow, max-image-preview:large',
  })
}
