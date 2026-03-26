// Marketplace listing bot handler — extracted from worker.js handleListingBotRequest
import {
  SITE_URL, BRAND_NAME, DEFAULT_OG_IMAGE,
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
import { buildHtmlDocument, buildMetaTags, buildSeoResponse } from '../html-builder.js'

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

  const lang = url.searchParams.get('lang') || 'en'
  const title = `${listing.title} — ${lang === 'ko' ? '플래시카드 덱' : 'Flashcard Deck'} | ${BRAND_NAME}`
  const description = listing.description || `${listing.title} — ${listing.card_count || 0} ${lang === 'ko' ? '장의 카드가 포함된 플래시카드 덱' : 'cards flashcard deck on'} ${BRAND_NAME}`
  const tags = listing.tags || []
  const canonicalUrl = localizedUrl(`/d/${listingId}`, lang)

  // JSON-LD schemas
  const datasetJsonLd = buildDatasetJsonLd(listing, description, tags, listingId, lang)
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

  const hreflangTags = buildHreflangTags(`/d/${escapeHtml(listingId)}`, true)

  const jsonLdScripts = [datasetJsonLd, breadcrumbJsonLd, buildOrganizationJsonLd()]
    .map((schema) => `<script type="application/ld+json">${JSON.stringify(schema)}</script>`)
    .join('\n')

  const head = `${metaTags}
${hreflangTags}
${jsonLdScripts}`

  const body = `<nav aria-label="breadcrumb"><ol><li><a href="${SITE_URL}">${BRAND_NAME}</a></li><li><a href="${SITE_URL}/landing">${lang === 'ko' ? '마켓플레이스' : 'Marketplace'}</a></li><li>${escapeHtml(listing.title)}</li></ol></nav>
<main>
<h1>${escapeHtml(listing.title)}</h1>
<p>${escapeHtml(description)}</p>
${listing.card_count ? `<p><strong>${listing.card_count}</strong> ${lang === 'ko' ? '장의 카드' : 'cards'}</p>` : ''}
${listing.owner_name ? `<p>${lang === 'ko' ? '만든이' : 'Created by'}: ${escapeHtml(listing.owner_name)}</p>` : ''}
${tags.length > 0 ? `<p>${lang === 'ko' ? '태그' : 'Tags'}: ${tags.map((t) => escapeHtml(t)).join(', ')}</p>` : ''}
<p><a href="${SITE_URL}/auth/login">${lang === 'ko' ? '이 덱으로 학습 시작하기' : 'Start studying this deck'}</a></p>
</main>
<footer>
<p><a href="${SITE_URL}/landing">← ${BRAND_NAME}</a></p>
</footer>`

  const html = buildHtmlDocument({ lang, head, body })

  return buildSeoResponse(html, {
    lang,
    cacheSeconds: 3600,
    robots: 'index, follow',
  })
}
