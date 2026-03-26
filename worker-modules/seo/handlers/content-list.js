// Content list page bot handler — extracted from worker.js handleContentListBot
import {
  SITE_URL, BRAND_NAME, DEFAULT_OG_IMAGE,
  LIST_TITLES, LIST_DESCS,
} from '../constants.js'
import {
  escapeHtml, buildHreflangTags,
  getSupabaseRestUrl, getSupabaseAnonKey,
  localizedUrl,
} from '../helpers.js'
import {
  buildCollectionPageJsonLd,
  buildItemListJsonLd,
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
} from '../json-ld.js'
import { buildHtmlDocument, buildMetaTags, buildSeoResponse } from '../html-builder.js'

export async function handleContentListBot(url, env) {
  const restUrl = getSupabaseRestUrl(env)
  const anonKey = getSupabaseAnonKey(env)
  const lang = url.searchParams.get('lang') || 'en'

  const res = await fetch(
    `${restUrl}/contents?is_published=eq.true&locale=eq.${lang}&select=slug,title,subtitle,locale,published_at,tags,reading_time_minutes,thumbnail_url&order=published_at.desc&limit=100`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
  )

  const articles = (await res.json()) || []
  const listTitle = LIST_TITLES[lang] || LIST_TITLES.en
  const listDesc = LIST_DESCS[lang] || LIST_DESCS.en
  const canonicalUrl = localizedUrl('/insight', lang)

  // JSON-LD schemas
  const collectionJsonLd = buildCollectionPageJsonLd(listTitle, listDesc, lang, articles.length)
  const itemListJsonLd = buildItemListJsonLd(articles)

  const metaTags = buildMetaTags({
    title: listTitle,
    description: listDesc,
    ogType: 'website',
    ogUrl: canonicalUrl,
    ogImage: DEFAULT_OG_IMAGE,
    locale: lang,
    canonical: canonicalUrl,
    keywords: 'spaced repetition, flashcards, study tips, learning strategies, active recall, SRS, memory techniques',
  })

  const feedLinks = `<link rel="alternate" type="application/rss+xml" title="${BRAND_NAME} Learning Insights" href="${SITE_URL}/feed.xml${lang !== 'en' ? `?lang=${lang}` : ''}">
<link rel="alternate" type="application/atom+xml" title="${BRAND_NAME} Learning Insights" href="${SITE_URL}/feed.atom${lang !== 'en' ? `?lang=${lang}` : ''}">`
  const hreflangTags = buildHreflangTags('/insight', true)

  const jsonLdScripts = [collectionJsonLd, itemListJsonLd, buildOrganizationJsonLd(), buildWebSiteJsonLd()]
    .map((schema) => `<script type="application/ld+json">${JSON.stringify(schema)}</script>`)
    .join('\n')

  const articlesHtml = articles.map((a) => {
    const dateStr = a.published_at ? new Date(a.published_at).toISOString().split('T')[0] : ''
    return `<article>
<h2><a href="${SITE_URL}/insight/${escapeHtml(a.slug)}">${escapeHtml(a.title)}</a></h2>
${a.subtitle ? `<p>${escapeHtml(a.subtitle)}</p>` : ''}
<div>
${dateStr ? `<time datetime="${escapeHtml(a.published_at)}">${dateStr}</time>` : ''}
${a.reading_time_minutes ? `<span>${a.reading_time_minutes} min read</span>` : ''}
${(a.tags || []).length > 0 ? a.tags.map((t) => `<a href="${SITE_URL}/insight?tag=${encodeURIComponent(t)}" rel="tag">${escapeHtml(t)}</a>`).join(' ') : ''}
</div>
</article>`
  }).join('\n')

  const head = `${metaTags}
${feedLinks}
${hreflangTags}
${jsonLdScripts}`

  const body = `<nav aria-label="breadcrumb"><ol><li><a href="${SITE_URL}">${BRAND_NAME}</a></li><li>${LIST_TITLES[lang]?.split(' — ')[0] || 'Learning Insights'}</li></ol></nav>
<main>
<header>
<h1>${escapeHtml(LIST_TITLES[lang]?.split(' — ')[0] || 'Learning Insights')}</h1>
<p>${escapeHtml(listDesc)}</p>
</header>
<section>
${articlesHtml}
</section>
</main>
<footer>
<p><a href="${SITE_URL}/landing">Start Learning with ${BRAND_NAME}</a></p>
</footer>`

  const html = buildHtmlDocument({ lang, head, body })

  return buildSeoResponse(html, {
    lang,
    cacheSeconds: 3600,
    robots: 'index, follow, max-image-preview:large',
  })
}
