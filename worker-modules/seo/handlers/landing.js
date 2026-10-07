// Landing page bot handler — extracted from worker.js handleLandingBotRequest
import {
  SITE_URL, BRAND_NAME, DEFAULT_OG_IMAGE,
  LANDING_TITLES, LANDING_DESCS, LANDING_FAQ, LANDING_HOWTO, LANDING_COPY,
  ROBOTS_INDEX, ROBOTS_NOINDEX,
} from '../constants.js'
import {
  escapeHtml, buildHreflangTags,
  localizedUrl,
} from '../helpers.js'
import { isUiLocale, isIndexable } from '../../locale-policy.js'
import {
  buildWebAppJsonLd,
  buildFAQJsonLd,
  buildHowToJsonLd,
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
} from '../json-ld.js'
import { buildHtmlDocument, buildMetaTags, buildSeoResponse, renderJsonLd } from '../html-builder.js'

export async function handleLandingBotRequest(url) {
  // Normalize untrusted ?lang; non-indexable locales (minor langs) → noindex,
  // consistent with insight pages and the en/ko-only landing sitemap entry.
  const rawLang = url.searchParams.get('lang')
  const lang = isUiLocale(rawLang) ? rawLang : 'en'
  const robots = isIndexable(lang) ? ROBOTS_INDEX : ROBOTS_NOINDEX
  const copy = LANDING_COPY[lang]
  const pageTitle = LANDING_TITLES[lang] || LANDING_TITLES.en
  const pageDesc = LANDING_DESCS[lang] || LANDING_DESCS.en
  const canonicalUrl = localizedUrl('/landing', lang)

  // JSON-LD schemas
  const webAppJsonLd = buildWebAppJsonLd(pageDesc, lang)
  const faqItems = LANDING_FAQ[lang] || LANDING_FAQ.en
  const faqJsonLd = buildFAQJsonLd(faqItems)
  const howToSteps = LANDING_HOWTO[lang] || LANDING_HOWTO.en
  const howToName = copy.howItWorks.title
  const howToJsonLd = buildHowToJsonLd(howToName, howToSteps, 'PT3M')

  const faqHtml = faqItems.map((f) =>
    `<details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`
  ).join('\n')

  const howToHtml = howToSteps.map((s, i) =>
    `<li><strong>${escapeHtml(s.name)}</strong>: ${escapeHtml(s.text)}</li>`
  ).join('\n')

  const metaTags = buildMetaTags({
    title: pageTitle,
    description: pageDesc,
    ogType: 'website',
    ogUrl: canonicalUrl,
    ogImage: DEFAULT_OG_IMAGE,
    locale: lang,
    canonical: canonicalUrl,
    keywords: 'spaced repetition, flashcards, SRS, study app, learning platform, memorization, active recall, flashcard app, free study tool',
  })

  const feedLinks = `<link rel="alternate" type="application/rss+xml" title="${BRAND_NAME} Learning Insights" href="${SITE_URL}/feed.xml${lang !== 'en' ? `?lang=${lang}` : ''}">
<link rel="alternate" type="application/atom+xml" title="${BRAND_NAME} Learning Insights" href="${SITE_URL}/feed.atom${lang !== 'en' ? `?lang=${lang}` : ''}">`
  const hreflangTags = buildHreflangTags('/landing', true)

  const jsonLdScripts = renderJsonLd([webAppJsonLd, faqJsonLd, howToJsonLd, buildOrganizationJsonLd(), buildWebSiteJsonLd()])

  const head = `${metaTags}
${feedLinks}
${hreflangTags}
${jsonLdScripts}`

  const body = `<main>
<header>
<h1>${escapeHtml(pageTitle)}</h1>
<p>${escapeHtml(pageDesc)}</p>
<a href="${SITE_URL}/auth/login">${lang === 'ko' ? '무료로 시작하기' : 'Start Learning for Free'}</a>
</header>

<section>
<h2>${escapeHtml(copy.features.title)}</h2>
<ul>
${['srs', 'modes', 'aiCards', 'quiz', 'plan', 'stats', 'sharing', 'tts', 'responsive'].filter((key) => copy.features[key]).map((key) => `<li><strong>${escapeHtml(copy.features[key].title)}</strong> — ${escapeHtml(copy.features[key].description || copy.features[key].desc)}</li>`).join('\n')}
</ul>
</section>

<section>
<h2>${escapeHtml(copy.howItWorks.title)}</h2>
<ol>${howToHtml}</ol>
</section>

<section>
<h2>${escapeHtml(copy.faq.title)}</h2>
${faqHtml}
</section>

<section>
<h2>${lang === 'ko' ? '학습 인사이트' : 'Learning Insights'}</h2>
<p>${lang === 'ko' ? '과학적 학습 전략, 간격 반복 팁 등 유용한 글을 확인하세요.' : 'Explore science-backed learning strategies, spaced repetition tips, and more.'}</p>
<a href="${localizedUrl('/insight', lang)}">${lang === 'ko' ? '인사이트 보기 →' : 'Browse Insights →'}</a>
</section>
</main>

<footer>
<p>&copy; ${new Date().getFullYear()} ${BRAND_NAME}. ${lang === 'ko' ? '과학적 학습으로 더 스마트하게.' : 'Learn smarter with science.'}</p>
<nav>
<a href="${canonicalUrl}">${lang === 'ko' ? '홈' : 'Home'}</a>
<a href="${localizedUrl('/insight', lang)}">${lang === 'ko' ? '인사이트' : 'Insights'}</a>
</nav>
</footer>`

  const html = buildHtmlDocument({ lang, head, body, robots })

  return buildSeoResponse(html, {
    lang,
    cacheSeconds: 3600,
    robots,
  })
}
