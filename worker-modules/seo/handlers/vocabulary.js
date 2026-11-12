// /vocabulary pages for crawlers: the English index, one index per deck language, and one English
// hub per exam level. Content is built by the same shared modules the web pages use.
import { SITE_URL, BRAND_NAME, DEFAULT_OG_IMAGE, ROBOTS_INDEX } from '../constants.js'
import { escapeHtml, getSupabaseRestUrl, getSupabaseAnonKey } from '../helpers.js'
import { buildBreadcrumbJsonLd, buildOrganizationJsonLd } from '../json-ld.js'
import { buildHtmlDocument, buildMetaTags, buildSeoResponse, renderJsonLd } from '../html-builder.js'
import {
  VOCAB_HUBS, VOCAB_INDEX_PATH, VOCAB_EN_INDEX, VOCAB_LANGUAGE_INDEX,
  VOCAB_HUB_CHOOSER_HEADING, VOCAB_HUB_COLUMNS, LANGUAGE_NATIVE_NAME,
  findVocabHub, isDeckLanguage, vocabHubPath, vocabLanguageIndexPath, vocabIndexHreflang,
  vocabHubHeading, vocabHubShortTitle, vocabHubDescription, vocabHubIntro,
  groupDecksForIndex, orderDecksByLanguage, vocabHubDeckTags,
} from '../../../packages/shared/lib/vocab-hubs.ts'
import { wordListHeading, wordRows } from '../../../packages/shared/lib/listing-seo.ts'

export async function handleVocabularyBot(slug, url, env) {
  if (!slug) return renderEnglishIndex()
  if (isDeckLanguage(slug)) return renderLanguageIndex(slug, env)
  const hub = findVocabHub(slug)
  return hub ? renderHub(hub, env) : null
}

function hreflangTags(alternates) {
  return alternates.map((h) => `<link rel="alternate" hreflang="${escapeHtml(h.lang)}" href="${escapeHtml(h.href)}">`).join('\n')
}

function page({ lang, title, description, canonicalUrl, alternates, breadcrumb, body }) {
  const metaTags = buildMetaTags({
    title: `${title} | ${BRAND_NAME}`,
    description,
    ogType: 'website',
    ogUrl: canonicalUrl,
    ogImage: DEFAULT_OG_IMAGE,
    locale: lang,
    canonical: canonicalUrl,
    keywords: title,
  })
  const head = `${metaTags}
${hreflangTags(alternates)}
${renderJsonLd([buildBreadcrumbJsonLd(breadcrumb), buildOrganizationJsonLd()])}`
  const html = buildHtmlDocument({ lang, head, body, robots: ROBOTS_INDEX })
  return buildSeoResponse(html, { lang, cacheSeconds: 3600, robots: ROBOTS_INDEX })
}

async function rest(env, path, init) {
  const anonKey = getSupabaseAnonKey(env)
  if (!anonKey) return null
  const res = await fetch(`${getSupabaseRestUrl(env)}${path}`, {
    ...init,
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
  })
  return res.ok ? res.json() : null
}

function renderEnglishIndex() {
  const canonicalUrl = `${SITE_URL}${VOCAB_INDEX_PATH}`
  const groups = ['toeic', 'ielts', 'toefl'].map((category) => {
    const items = VOCAB_HUBS.filter((h) => h.category === category)
      .map((h) => `<li><a href="${SITE_URL}${vocabHubPath(h)}">${escapeHtml(vocabHubShortTitle(h))}</a></li>`).join('\n')
    return `<h2>${category.toUpperCase()}</h2>\n<ul>\n${items}\n</ul>`
  }).join('\n')
  const languages = Object.entries(LANGUAGE_NATIVE_NAME)
    .map(([l, name]) => `<li><a href="${SITE_URL}${vocabLanguageIndexPath(l)}" hreflang="${l}">${escapeHtml(name)}</a></li>`).join('\n')
  const body = `<main>
<h1>${escapeHtml(VOCAB_EN_INDEX.heading)}</h1>
<p>${escapeHtml(VOCAB_EN_INDEX.intro)}</p>
${groups}
<h2>${escapeHtml(VOCAB_EN_INDEX.languagesHeading)}</h2>
<ul>
${languages}
</ul>
</main>`
  return page({
    lang: 'en',
    title: VOCAB_EN_INDEX.heading,
    description: VOCAB_EN_INDEX.description,
    canonicalUrl,
    alternates: vocabIndexHreflang(SITE_URL),
    breadcrumb: [{ name: BRAND_NAME, url: SITE_URL }, { name: VOCAB_EN_INDEX.heading, url: canonicalUrl }],
    body,
  })
}

async function renderLanguageIndex(lang, env) {
  const decks = await rest(env,
    `/marketplace_listings?select=id,title,category,card_count,tags,owner_is_official,native_language`
    + `&is_active=eq.true&owner_is_official=eq.true&native_language=eq.${lang}&limit=1000`)
  if (!Array.isArray(decks) || decks.length === 0) return null
  const copy = VOCAB_LANGUAGE_INDEX[lang]
  const canonicalUrl = `${SITE_URL}${vocabLanguageIndexPath(lang)}`
  const sections = groupDecksForIndex(decks).map(({ category, decks: inGroup }) => {
    const items = inGroup
      .map((d) => `<li><a href="${SITE_URL}/d/${escapeHtml(d.id)}">${escapeHtml(wordListHeading({ ...d, sample_fields: [] }, lang))}</a></li>`)
      .join('\n')
    return `<h2>${escapeHtml(copy.categories[category])}</h2>\n<ul>\n${items}\n</ul>`
  }).join('\n')
  const body = `<main>
<h1>${escapeHtml(copy.heading)}</h1>
<p>${escapeHtml(copy.intro)}</p>
${sections}
<p><a href="${SITE_URL}${VOCAB_INDEX_PATH}" hreflang="en">${escapeHtml(VOCAB_EN_INDEX.heading)}</a></p>
</main>`
  return page({
    lang,
    title: copy.heading,
    description: copy.description,
    canonicalUrl,
    alternates: vocabIndexHreflang(SITE_URL),
    breadcrumb: [{ name: BRAND_NAME, url: SITE_URL }, { name: copy.heading, url: canonicalUrl }],
    body,
  })
}

async function renderHub(hub, env) {
  const level = encodeURIComponent(`{${vocabHubDeckTags(hub).join(',')}}`)
  const decks = await rest(env,
    `/marketplace_listings?select=id,native_language,card_count&is_active=eq.true&owner_is_official=eq.true`
    + `&category=eq.${hub.category}&tags=cs.${level}&limit=20`)
  if (!Array.isArray(decks) || decks.length === 0) return null
  const ordered = orderDecksByLanguage(decks)
  // Every language version shares the same English words — any one gives the word list.
  const preview = await rest(env, '/rpc/get_public_listing_preview', {
    method: 'POST',
    body: JSON.stringify({ p_listing_id: ordered[0].id }),
  })
  if (!preview) return null
  const rows = wordRows(preview)
  const wordCount = preview.card_count || ordered[0].card_count || 0
  const heading = vocabHubHeading(hub, wordCount)
  const canonicalUrl = `${SITE_URL}${vocabHubPath(hub)}`
  const chooser = ordered
    .map((d) => `<li><a href="${SITE_URL}/d/${escapeHtml(d.id)}" hreflang="${escapeHtml(d.native_language)}">${escapeHtml(LANGUAGE_NATIVE_NAME[d.native_language])}</a></li>`)
    .join('\n')
  const tableRows = rows
    .map((r) => `<tr><td><strong>${escapeHtml(r.term)}</strong></td><td>${escapeHtml(r.example)}</td></tr>`)
    .join('\n')
  const body = `<nav aria-label="breadcrumb"><ol><li><a href="${SITE_URL}">${BRAND_NAME}</a></li><li><a href="${SITE_URL}${VOCAB_INDEX_PATH}">${escapeHtml(VOCAB_EN_INDEX.heading)}</a></li><li>${escapeHtml(vocabHubShortTitle(hub))}</li></ol></nav>
<main>
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(vocabHubIntro(wordCount, rows.length))}</p>
<h2>${escapeHtml(VOCAB_HUB_CHOOSER_HEADING)}</h2>
<ul>
${chooser}
</ul>
<table>
<thead><tr><th>${VOCAB_HUB_COLUMNS[0]}</th><th>${VOCAB_HUB_COLUMNS[1]}</th></tr></thead>
<tbody>
${tableRows}
</tbody>
</table>
</main>`
  const alternates = [
    ...ordered.map((d) => ({ lang: d.native_language, href: `${SITE_URL}/d/${d.id}` })),
    { lang: 'en', href: canonicalUrl },
    { lang: 'x-default', href: canonicalUrl },
  ]
  return page({
    lang: 'en',
    title: heading,
    description: vocabHubDescription(hub, wordCount, rows.length),
    canonicalUrl,
    alternates,
    breadcrumb: [
      { name: BRAND_NAME, url: SITE_URL },
      { name: VOCAB_EN_INDEX.heading, url: `${SITE_URL}${VOCAB_INDEX_PATH}` },
      { name: vocabHubShortTitle(hub), url: canonicalUrl },
    ],
    body,
  })
}
