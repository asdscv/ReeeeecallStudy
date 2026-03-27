// Landing page bot handler — extracted from worker.js handleLandingBotRequest
import {
  SITE_URL, BRAND_NAME, DEFAULT_OG_IMAGE,
  LANDING_TITLES, LANDING_DESCS, LANDING_FAQ, LANDING_HOWTO,
} from '../constants.js'
import {
  escapeHtml, buildHreflangTags,
  localizedUrl,
} from '../helpers.js'
import {
  buildWebAppJsonLd,
  buildFAQJsonLd,
  buildHowToJsonLd,
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  buildCourseJsonLd,
  buildProfilePageJsonLd,
} from '../json-ld.js'
import { buildHtmlDocument, buildMetaTags, buildSeoResponse } from '../html-builder.js'

export async function handleLandingBotRequest(url) {
  const lang = url.searchParams.get('lang') || 'en'
  const pageTitle = LANDING_TITLES[lang] || LANDING_TITLES.en
  const pageDesc = LANDING_DESCS[lang] || LANDING_DESCS.en
  const canonicalUrl = localizedUrl('/landing', lang)

  // JSON-LD schemas
  const webAppJsonLd = buildWebAppJsonLd(pageDesc, lang)
  const faqItems = LANDING_FAQ[lang] || LANDING_FAQ.en
  const faqJsonLd = buildFAQJsonLd(faqItems)
  const howToSteps = LANDING_HOWTO[lang] || LANDING_HOWTO.en
  const howToName = lang === 'ko' ? 'ReeeeecallStudy 시작하기' : 'Get Started with ReeeeecallStudy'
  const howToJsonLd = buildHowToJsonLd(howToName, howToSteps, 'PT5M')
  const courseJsonLd = buildCourseJsonLd(lang)
  const profilePageJsonLd = buildProfilePageJsonLd(pageDesc, lang)

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
<link rel="alternate" type="application/atom+xml" title="${BRAND_NAME} Learning Insights" href="${SITE_URL}/feed.atom${lang !== 'en' ? `?lang=${lang}` : ''}">
<link rel="search" type="application/opensearchdescription+xml" title="${BRAND_NAME}" href="${SITE_URL}/opensearch.xml">`
  const hreflangTags = buildHreflangTags('/landing', true)

  const jsonLdScripts = [webAppJsonLd, faqJsonLd, howToJsonLd, buildOrganizationJsonLd(), buildWebSiteJsonLd(), courseJsonLd, profilePageJsonLd]
    .map((schema) => `<script type="application/ld+json">${JSON.stringify(schema)}</script>`)
    .join('\n')

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
<h2>${lang === 'ko' ? '주요 기능' : 'Key Features'}</h2>
<ul>
<li><strong>${lang === 'ko' ? '간격 반복 (SRS)' : 'Spaced Repetition (SRS)'}</strong> — ${lang === 'ko' ? '과학적으로 최적화된 복습 일정으로 장기 기억력 향상' : 'Scientifically optimized review scheduling for long-term retention'}</li>
<li><strong>${lang === 'ko' ? '5가지 학습 모드' : '5 Study Modes'}</strong> — ${lang === 'ko' ? 'SRS, 벼락치기, 퀴즈, 매칭, 쓰기' : 'SRS, Cramming, Quiz, Matching, Writing'}</li>
<li><strong>${lang === 'ko' ? '덱 공유' : 'Deck Sharing'}</strong> — ${lang === 'ko' ? '마켓플레이스에서 공유하거나 비공개 링크로 전달' : 'Share on marketplace or via private links'}</li>
<li><strong>${lang === 'ko' ? '실시간 분석' : 'Real-time Analytics'}</strong> — ${lang === 'ko' ? '학습 패턴, 기억률, 진행 상황 추적' : 'Track study patterns, retention rates, and progress'}</li>
<li><strong>${lang === 'ko' ? '다국어 지원' : 'Multilingual'}</strong> — ${lang === 'ko' ? '한국어, 영어 등 8개 언어 지원' : 'Available in 8 languages including English and Korean'}</li>
</ul>
</section>

<section>
<h2>${lang === 'ko' ? '시작하는 방법' : 'How to Get Started'}</h2>
<ol>${howToHtml}</ol>
</section>

<section>
<h2>${lang === 'ko' ? '자주 묻는 질문' : 'Frequently Asked Questions'}</h2>
${faqHtml}
</section>

<section>
<h2>${lang === 'ko' ? '학습 인사이트' : 'Learning Insights'}</h2>
<p>${lang === 'ko' ? '과학적 학습 전략, 간격 반복 팁 등 유용한 글을 확인하세요.' : 'Explore science-backed learning strategies, spaced repetition tips, and more.'}</p>
<a href="${SITE_URL}/insight">${lang === 'ko' ? '인사이트 보기 →' : 'Browse Insights →'}</a>
</section>
</main>

<footer>
<p>&copy; ${new Date().getFullYear()} ${BRAND_NAME}. ${lang === 'ko' ? '과학적 학습으로 더 스마트하게.' : 'Learn smarter with science.'}</p>
<nav>
<a href="${SITE_URL}/landing">${lang === 'ko' ? '홈' : 'Home'}</a>
<a href="${SITE_URL}/insight">${lang === 'ko' ? '인사이트' : 'Insights'}</a>
<a href="${SITE_URL}/docs/api">API</a>
</nav>
</footer>`

  const html = buildHtmlDocument({ lang, head, body })

  return buildSeoResponse(html, {
    lang,
    cacheSeconds: 3600,
    robots: 'index, follow, max-image-preview:large',
  })
}
