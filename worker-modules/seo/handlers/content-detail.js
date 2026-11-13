import { contentCanonicalUrl } from '../../../packages/shared/lib/content-canonical.ts'
// Content detail page bot handler — extracted from worker.js handleContentDetailBot
import {
  SITE_URL, BRAND_NAME, DEFAULT_OG_IMAGE,
  LIST_TITLES, ROBOTS_INDEX, ROBOTS_NOINDEX, pageChrome,
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
import { withDropOffCtas } from '../../../packages/shared/lib/content-drop-off.ts'
import { parseDeckFamily, deckListingFilter } from '../../../packages/shared/lib/official-deck-family.ts'
import { wordListHeading } from '../../../packages/shared/lib/listing-seo.ts'
import {
  VOCAB_INDEX_PATH, VOCAB_EN_INDEX, VOCAB_LANGUAGE_INDEX,
  isDeckLanguage, vocabHubForFamily, vocabHubPath, vocabHubShortTitle, vocabLanguageIndexPath,
} from '../../../packages/shared/lib/vocab-hubs.ts'
import { buildHtmlDocument, buildMetaTags, buildSeoResponse, renderJsonLd } from '../html-builder.js'
import { INDEXABLE_LOCALES, isIndexable, isUiLocale, DEFAULT_LOCALE } from '../../locale-policy.js'

export async function handleContentDetailBot(slug, url, env) {
  const restUrl = getSupabaseRestUrl(env)
  const anonKey = getSupabaseAnonKey(env)
  // Normalize untrusted ?lang against the registry: only a real UI locale is
  // allowed through to fetches, headers and reflected hrefs (closes injection/XSS).
  const rawLang = url.searchParams.get('lang')
  const lang = isUiLocale(rawLang) ? rawLang : 'en'

  // Two queries: (1) cheap select=locale to learn which locales exist for this
  // slug (drives hreflang), (2) fetch ONLY the chosen article's full row (avoids
  // pulling every locale's content_blocks). Chosen = requested → default(en) → any.
  let present = []
  let article = null
  try {
    const hdr = { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
    const localesRes = await fetch(
      `${restUrl}/contents?slug=eq.${encodeURIComponent(slug)}&is_published=eq.true&select=locale&order=locale.asc`,
      { headers: hdr },
    )
    if (localesRes.ok) present = ((await localesRes.json()) || []).map((r) => r.locale)
    const chosen = present.includes(lang)
      ? lang
      : (present.includes(DEFAULT_LOCALE) ? DEFAULT_LOCALE : present[0])
    if (chosen) {
      const artRes = await fetch(
        `${restUrl}/contents?slug=eq.${encodeURIComponent(slug)}&is_published=eq.true&locale=eq.${chosen}&limit=1`,
        { headers: hdr },
      )
      if (artRes.ok) article = (await artRes.json())?.[0]
    }
  } catch (err) {
    console.error('Content detail fetch error:', err)
    return null
  }
  if (!article) return null

  // hreflang: only locales that BOTH exist for this slug AND are indexable, in
  // canonical (registry) order. Robots: non-indexable locales (legacy minor-language
  // pages we no longer index) get noindex so they stop diluting site-wide quality,
  // while staying live for users.
  const presentSet = new Set(present)
  const availableLocales = INDEXABLE_LOCALES.filter((l) => presentSet.has(l))
  const robots = isIndexable(article.locale) ? ROBOTS_INDEX : ROBOTS_NOINDEX

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
  const deckLink = await resolveDeckLink(article, restUrl, anonKey)
  const bodyHtml = renderBlocksToHtml(withDropOffCtas(blocks, slug, article.deck_family), { deckLink })
    + `\n${wordListsLink(article.locale)}`

  const canonicalUrl = contentCanonicalUrl(SITE_URL, slug, article.locale, article.canonical_url)

  // Build JSON-LD schemas
  const articleJsonLd = buildArticleJsonLd(article, slug)
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: BRAND_NAME, url: SITE_URL },
    { name: LIST_TITLES[article.locale]?.split(' — ')[0] || 'Learning Insights', url: `${SITE_URL}/insight` },
    { name: article.title, url: canonicalUrl },
  ])
  const learningResourceJsonLd = buildLearningResourceJsonLd(article, slug)

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

  const feedLinks = `<link rel="alternate" type="application/rss+xml" title="${BRAND_NAME} Learning Insights" href="${SITE_URL}/feed.xml${article.locale !== 'en' ? `?lang=${article.locale}` : ''}">`
  const hreflangTags = buildHreflangTags(`/insight/${escapeHtml(slug)}`, true, availableLocales)

  const jsonLdScripts = renderJsonLd([articleJsonLd, breadcrumbJsonLd, learningResourceJsonLd, buildOrganizationJsonLd()])

  const head = `${metaTags}
${feedLinks}
${hreflangTags}
${jsonLdScripts}`

  const body = `<nav aria-label="breadcrumb"><ol><li><a href="${SITE_URL}">${BRAND_NAME}</a></li><li><a href="${localizedUrl('/insight', article.locale)}">${LIST_TITLES[article.locale]?.split(' — ')[0] || 'Learning Insights'}</a></li><li>${escapeHtml(article.title)}</li></ol></nav>
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
<h2>${pageChrome(article.locale).related}</h2>
<ul>
${relatedArticles.map((r) => {
  const rDate = r.published_at ? new Date(r.published_at).toISOString().split('T')[0] : ''
  return `<li><a href="${localizedUrl(`/insight/${escapeHtml(r.slug)}`, article.locale)}">${escapeHtml(r.title)}</a>${r.subtitle ? ` — ${escapeHtml(r.subtitle)}` : ''}${rDate ? ` <time datetime="${r.published_at}">(${rDate})</time>` : ''}</li>`
}).join('\n')}
</ul>
</aside>` : ''}
<footer>
<p><a href="${localizedUrl('/insight', article.locale)}">← ${pageChrome(article.locale).moreInsights}</a></p>
<p><a href="${localizedUrl('/landing', article.locale)}">${pageChrome(article.locale).startLearning}</a></p>
</footer>`

  const html = buildHtmlDocument({ lang: article.locale, head, body, robots })

  return buildSeoResponse(html, {
    lang: article.locale,
    cacheSeconds: 3600,
    robots,
  })
}

// The deck a deck-guide article leads to, as a crawlable link: the deck page in the article's
// language, or the English hub for the English edition (there is no English deck).
async function resolveDeckLink(article, restUrl, anonKey) {
  const family = parseDeckFamily(article.deck_family)
  if (!family) return null
  const filter = isDeckLanguage(article.locale) ? deckListingFilter(family, article.locale) : null
  if (filter) {
    try {
      const tags = encodeURIComponent(`{${filter.tags.join(',')}}`)
      const res = await fetch(
        `${restUrl}/marketplace_listings?select=id,title,category,card_count,tags,owner_is_official,native_language`
          + `&is_active=eq.true&owner_is_official=eq.true&category=eq.${filter.category}&tags=cs.${tags}&limit=1`,
        { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
      )
      const [deck] = res.ok ? await res.json() : []
      if (deck) return { href: `${SITE_URL}/d/${deck.id}`, label: wordListHeading({ ...deck, sample_fields: [] }, article.locale) }
    } catch { /* fall through to the hub */ }
  }
  const hub = vocabHubForFamily(article.deck_family)
  return hub ? { href: `${SITE_URL}${vocabHubPath(hub)}`, label: vocabHubShortTitle(hub) } : null
}

// Every article links to the word lists in its language — a crawl path into all deck pages.
function wordListsLink(locale) {
  if (isDeckLanguage(locale)) {
    return `<p><a href="${SITE_URL}${vocabLanguageIndexPath(locale)}">${escapeHtml(VOCAB_LANGUAGE_INDEX[locale].backToIndex)}</a></p>`
  }
  return `<p><a href="${SITE_URL}${VOCAB_INDEX_PATH}">${escapeHtml(VOCAB_EN_INDEX.heading)}</a></p>`
}
