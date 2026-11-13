// Marketplace listing bot handler — extracted from worker.js handleListingBotRequest
import {
  SITE_URL, BRAND_NAME, DEFAULT_OG_IMAGE,
  ROBOTS_INDEX, UI_LOCALES,
} from '../constants.js'
import {
  escapeHtml, buildHreflangTags,
  getSupabaseRestUrl, getSupabaseAnonKey,
  localizedUrl,
} from '../helpers.js'
import {
  buildDatasetJsonLd,
  buildBreadcrumbJsonLd,
  buildOrganizationJsonLd,
} from '../json-ld.js'
import { buildHtmlDocument, buildMetaTags, buildSeoResponse, renderJsonLd } from '../html-builder.js'
import { renderSampleCardsHtml, buildSampleCardLearningResources } from '../card-preview.js'
import { isUiLocale } from '../../locale-policy.js'
import {
  wordListPageLanguage, wordListHeading, wordListDescription, wordListIntro,
  wordListColumns, wordListCta, wordListHreflang, wordRows, wordListIndexLink,
} from '../../../packages/shared/lib/listing-seo.ts'

export async function handleListingBotRequest(listingId, url, env) {
  const restUrl = getSupabaseRestUrl(env)
  const anonKey = getSupabaseAnonKey(env)
  if (!anonKey) return null

  const res = await fetch(
    `${restUrl}/rpc/get_public_listing_preview`,
    {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_listing_id: listingId }),
    },
  )

  if (!res.ok) return null
  const listing = await res.json()
  if (!listing || !listing.title) return null

  const pageLang = wordListPageLanguage(listing)
  if (pageLang) return renderWordListPage(listing, listingId, pageLang)

  const rawLang = url.searchParams.get('lang')
  const lang = isUiLocale(rawLang) ? rawLang : 'en'
  const title = `${listing.title} — ${lang === 'ko' ? '플래시카드 덱' : 'Flashcard Deck'} | ${BRAND_NAME}`
  const description = listing.description || `${listing.title} — ${listing.card_count || 0} ${lang === 'ko' ? '장의 카드가 포함된 플래시카드 덱' : 'cards flashcard deck on'} ${BRAND_NAME}`
  const tags = listing.tags || []
  const canonicalUrl = localizedUrl(`/d/${listingId}`, lang)

  // JSON-LD schemas — Dataset enriched with sample-card LearningResource items
  const sampleResources = buildSampleCardLearningResources(
    listing.sample_fields,
    listingId,
    lang,
  )
  const datasetJsonLd = buildDatasetJsonLd(listing, listingId, lang)
  if (sampleResources.length > 0) {
    datasetJsonLd.hasPart = sampleResources
  }
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: BRAND_NAME, url: SITE_URL },
    { name: lang === 'ko' ? '마켓플레이스' : 'Marketplace', url: `${SITE_URL}/landing` },
    { name: listing.title, url: `${SITE_URL}/d/${listingId}` },
  ])

  const metaTags = buildMetaTags({
    title,
    description,
    ogType: 'website',
    ogUrl: canonicalUrl,
    ogImage: DEFAULT_OG_IMAGE,
    locale: lang,
    canonical: canonicalUrl,
    keywords: tags.join(', '),
  })

  // Listings are real product pages served in all UI languages (outside the
  // insight noindex policy) — advertise hreflang for every UI locale.
  const hreflangTags = buildHreflangTags(`/d/${escapeHtml(listingId)}`, true, UI_LOCALES)

  const jsonLdScripts = renderJsonLd([datasetJsonLd, breadcrumbJsonLd, buildOrganizationJsonLd()])

  const head = `${metaTags}
${hreflangTags}
${jsonLdScripts}`

  const sampleCardsHtml = renderSampleCardsHtml(listing.sample_fields, lang, listing.title)

  const body = `<nav aria-label="breadcrumb"><ol><li><a href="${SITE_URL}">${BRAND_NAME}</a></li><li><a href="${SITE_URL}/landing">${lang === 'ko' ? '마켓플레이스' : 'Marketplace'}</a></li><li>${escapeHtml(listing.title)}</li></ol></nav>
<main>
<h1>${escapeHtml(listing.title)}</h1>
<p>${escapeHtml(description)}</p>
${listing.card_count ? `<p><strong>${listing.card_count}</strong> ${lang === 'ko' ? '장의 카드' : 'cards'}</p>` : ''}
${listing.owner_name ? `<p>${lang === 'ko' ? '만든이' : 'Created by'}: ${escapeHtml(listing.owner_name)}</p>` : ''}
${tags.length > 0 ? `<p>${lang === 'ko' ? '태그' : 'Tags'}: ${tags.map((t) => escapeHtml(t)).join(', ')}</p>` : ''}
${sampleCardsHtml}
<p><a href="${SITE_URL}/auth/login">${lang === 'ko' ? '이 덱으로 학습 시작하기' : 'Start studying this deck'}</a></p>
</main>
<footer>
<p><a href="${SITE_URL}/landing">← ${BRAND_NAME}</a></p>
</footer>`

  const html = buildHtmlDocument({ lang, head, body, robots: ROBOTS_INDEX })

  return buildSeoResponse(html, {
    lang,
    cacheSeconds: 3600,
    robots: ROBOTS_INDEX,
  })
}

// Official decks: a word-list page in the deck's own language — the shape of the pages that win
// «toeic 800 words»-type searches. One URL per deck (no ?lang variants); hreflang links the same
// exam level across native languages.
function renderWordListPage(listing, listingId, lang) {
  const heading = wordListHeading(listing, lang)
  const title = `${heading} | ${BRAND_NAME}`
  const description = wordListDescription(listing, lang)
  const canonicalUrl = `${SITE_URL}/d/${listingId}`
  const rows = wordRows(listing)
  const [termCol, meaningCol, exampleCol] = wordListColumns(lang, listing.category)
  const studyUrl = `${SITE_URL}/auth/login?redirect=${encodeURIComponent(`/marketplace/${listingId}`)}`

  const datasetJsonLd = { ...buildDatasetJsonLd(listing, listingId, lang), name: heading, description }
  const sampleResources = buildSampleCardLearningResources(listing.sample_fields, listingId, lang)
  if (sampleResources.length > 0) datasetJsonLd.hasPart = sampleResources
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: BRAND_NAME, url: SITE_URL },
    { name: wordListIndexLink(lang).label, url: `${SITE_URL}${wordListIndexLink(lang).path}` },
    { name: heading, url: canonicalUrl },
  ])

  const metaTags = buildMetaTags({
    title,
    description,
    ogType: 'website',
    ogUrl: canonicalUrl,
    ogImage: DEFAULT_OG_IMAGE,
    locale: lang,
    canonical: canonicalUrl,
    keywords: heading,
  })
  const hreflangTags = wordListHreflang(listing, SITE_URL)
    .map((h) => `<link rel="alternate" hreflang="${escapeHtml(h.lang)}" href="${escapeHtml(h.href)}">`)
    .join('\n')
  const head = `${metaTags}
${hreflangTags}
${renderJsonLd([datasetJsonLd, breadcrumbJsonLd, buildOrganizationJsonLd()])}`

  const tableRows = rows.map((r) => `<tr><td lang="en"><strong>${escapeHtml(r.term)}</strong></td><td>${escapeHtml(r.meaning)}</td><td>${r.example ? `<span lang="en">${escapeHtml(r.example)}</span>` : ''}${r.exampleNote ? `<br><small>${escapeHtml(r.exampleNote)}</small>` : ''}</td></tr>`).join('\n')

  const index = wordListIndexLink(lang)
  const body = `<nav aria-label="breadcrumb"><ol><li><a href="${SITE_URL}">${BRAND_NAME}</a></li><li><a href="${SITE_URL}${index.path}">${escapeHtml(index.label)}</a></li><li>${escapeHtml(heading)}</li></ol></nav>
<main>
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(wordListIntro(listing, lang))}</p>
<table>
<thead><tr><th>${escapeHtml(termCol)}</th><th>${escapeHtml(meaningCol)}</th><th>${escapeHtml(exampleCol)}</th></tr></thead>
<tbody>
${tableRows}
</tbody>
</table>
<p><a href="${escapeHtml(studyUrl)}">${escapeHtml(wordListCta(listing, lang))}</a></p>
</main>
<footer>
<p><a href="${SITE_URL}/landing">← ${BRAND_NAME}</a></p>
</footer>`

  const html = buildHtmlDocument({ lang, head, body, robots: ROBOTS_INDEX })
  return buildSeoResponse(html, { lang, cacheSeconds: 3600, robots: ROBOTS_INDEX })
}
