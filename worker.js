// Cloudflare Worker — API 프록시 + SPA fallback + SEO/AEO 프리렌더링 + AI 콘텐츠 생성
import { runContentPipeline } from './worker-modules/content-pipeline.js'
const SUPABASE_BASE = 'https://ixdapelfikaneexnskfm.supabase.co/functions/v1/api'
const SITE_URL = 'https://reeeeecallstudy.xyz'
const BRAND_NAME = 'ReeeeecallStudy'
const TWITTER_HANDLE = '@reeeeecallstudy'
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`
const OG_IMAGE_WIDTH = 1200
const OG_IMAGE_HEIGHT = 630

const SUPPORTED_LOCALES = ['en', 'ko', 'zh', 'ja', 'vi', 'th', 'id', 'es']
const OG_LOCALE_MAP = {
  en: 'en_US', ko: 'ko_KR', zh: 'zh_CN', ja: 'ja_JP',
  vi: 'vi_VN', th: 'th_TH', id: 'id_ID', es: 'es_ES',
}

const LIST_TITLES = {
  en: 'Learning Insights — Science-Backed Study Strategies | ReeeeecallStudy',
  ko: '학습 인사이트 — 과학적 학습 전략 | ReeeeecallStudy',
  zh: '学习洞察 — 科学学习策略 | ReeeeecallStudy',
  ja: '学習インサイト — 科学的学習戦略 | ReeeeecallStudy',
  vi: 'Kiến thức Học tập — Chiến lược Học tập Khoa học | ReeeeecallStudy',
  th: 'ข้อมูลเชิงลึกด้านการเรียนรู้ — กลยุทธ์การเรียนรู้ทางวิทยาศาสตร์ | ReeeeecallStudy',
  id: 'Wawasan Belajar — Strategi Belajar Berbasis Sains | ReeeeecallStudy',
  es: 'Perspectivas de Aprendizaje — Estrategias de Estudio Científicas | ReeeeecallStudy',
}
const LIST_DESCS = {
  en: 'Discover science-backed learning strategies, spaced repetition tips, and active recall techniques. Free articles to help you study smarter and remember longer.',
  ko: '과학적으로 검증된 학습 전략, 간격 반복 학습법, 능동적 회상 기법을 알아보세요. 더 스마트하게 공부하고 오래 기억하는 방법을 무료로 제공합니다.',
  zh: '探索经过科学验证的学习策略、间隔重复学习技巧和主动回忆技术。免费文章帮助你更聪明地学习、记忆更持久。',
  ja: '科学的に検証された学習戦略、間隔反復学習のコツ、アクティブリコール技法を発見しましょう。よりスマートに学び、より長く記憶するための無料記事。',
  vi: 'Khám phá các chiến lược học tập dựa trên khoa học, mẹo lặp lại ngắt quãng và kỹ thuật nhớ lại chủ động. Bài viết miễn phí giúp bạn học thông minh hơn.',
  th: 'ค้นพบกลยุทธ์การเรียนรู้ที่ได้รับการพิสูจน์ทางวิทยาศาสตร์ เคล็ดลับการทบทวนแบบเว้นระยะ และเทคนิคการจำแบบ Active Recall',
  id: 'Temukan strategi belajar berbasis sains, tips pengulangan berjarak, dan teknik active recall. Artikel gratis untuk membantu Anda belajar lebih cerdas.',
  es: 'Descubre estrategias de aprendizaje respaldadas por la ciencia, consejos de repetición espaciada y técnicas de recuerdo activo. Artículos gratuitos.',
}
const LANDING_TITLES = {
  en: 'ReeeeecallStudy — Smart Flashcard Learning with Spaced Repetition',
  ko: 'ReeeeecallStudy — 간격 반복 학습 기반 스마트 플래시카드',
  zh: 'ReeeeecallStudy — 基于间隔重复的智能闪卡学习',
  ja: 'ReeeeecallStudy — 間隔反復学習に基づくスマートフラッシュカード',
  vi: 'ReeeeecallStudy — Học Flashcard Thông minh với Lặp lại Ngắt quãng',
  th: 'ReeeeecallStudy — เรียนรู้ด้วยแฟลชการ์ดอัจฉริยะพร้อมการทบทวนแบบเว้นระยะ',
  id: 'ReeeeecallStudy — Belajar Flashcard Cerdas dengan Pengulangan Berjarak',
  es: 'ReeeeecallStudy — Aprendizaje Inteligente con Tarjetas y Repetición Espaciada',
}
const LANDING_DESCS = {
  en: 'Free smart flashcard learning platform with scientifically proven spaced repetition (SRS) algorithm. 5 study modes, deck sharing, real-time analytics. Remember faster and longer.',
  ko: '과학적으로 검증된 간격 반복(SRS) 알고리즘 기반 무료 스마트 플래시카드 학습 플랫폼. 5가지 학습 모드, 덱 공유, 실시간 분석. 더 빠르고 오래 기억하세요.',
  zh: '采用经过科学验证的间隔重复(SRS)算法的免费智能闪卡学习平台。5种学习模式、卡组分享、实时分析。记得更快、更久。',
  ja: '科学的に実証された間隔反復(SRS)アルゴリズムを搭載した無料スマートフラッシュカード学習プラットフォーム。5つの学習モード、デッキ共有、リアルタイム分析。',
  vi: 'Nền tảng học flashcard thông minh miễn phí với thuật toán lặp lại ngắt quãng (SRS) đã được khoa học chứng minh. 5 chế độ học, chia sẻ bộ thẻ, phân tích thời gian thực.',
  th: 'แพลตฟอร์มเรียนรู้ด้วยแฟลชการ์ดอัจฉริยะฟรี พร้อมอัลกอริทึมการทบทวนแบบเว้นระยะ (SRS) ที่พิสูจน์แล้วทางวิทยาศาสตร์ 5 โหมดการเรียน แชร์เด็ค วิเคราะห์แบบเรียลไทม์',
  id: 'Platform belajar flashcard cerdas gratis dengan algoritma pengulangan berjarak (SRS) yang terbukti secara ilmiah. 5 mode belajar, berbagi deck, analitik real-time.',
  es: 'Plataforma gratuita de aprendizaje con tarjetas inteligentes y algoritmo de repetición espaciada (SRS) científicamente probado. 5 modos de estudio, compartir mazos, análisis en tiempo real.',
}

// Landing page FAQ (en/ko) for prerendered structured data
const LANDING_FAQ = {
  en: [
    { q: 'What is spaced repetition?', a: 'Spaced repetition is a scientifically proven learning technique that schedules reviews at increasing intervals. It leverages the spacing effect to move information from short-term to long-term memory efficiently.' },
    { q: 'Is ReeeeecallStudy free?', a: 'Yes! ReeeeecallStudy is completely free. Create unlimited decks, use all 5 study modes, share with friends, and track your progress with detailed analytics — all at no cost.' },
    { q: 'What study modes are available?', a: 'ReeeeecallStudy offers 5 study modes: SRS (spaced repetition), Cramming, Quiz, Matching, and Writing. Each mode targets different aspects of learning for comprehensive mastery.' },
    { q: 'Can I share my flashcard decks?', a: 'Absolutely! You can share decks publicly on the marketplace or send private links to friends. Import shared decks with one click to start studying immediately.' },
  ],
  ko: [
    { q: '간격 반복 학습이란 무엇인가요?', a: '간격 반복 학습은 과학적으로 검증된 학습 기법으로, 점점 늘어나는 간격으로 복습을 예약합니다. 간격 효과를 활용하여 정보를 단기 기억에서 장기 기억으로 효율적으로 이동시킵니다.' },
    { q: 'ReeeeecallStudy는 무료인가요?', a: '네! ReeeeecallStudy는 완전 무료입니다. 무제한 덱 생성, 5가지 학습 모드, 친구와 공유, 상세 분석 추적 등 모든 기능을 무료로 사용하세요.' },
    { q: '어떤 학습 모드가 있나요?', a: 'ReeeeecallStudy는 SRS(간격 반복), 벼락치기, 퀴즈, 매칭, 쓰기의 5가지 학습 모드를 제공합니다. 각 모드는 학습의 다양한 측면을 목표로 합니다.' },
    { q: '플래시카드 덱을 공유할 수 있나요?', a: '물론입니다! 마켓플레이스에 공개 공유하거나 친구에게 비공개 링크를 보낼 수 있습니다. 공유된 덱을 클릭 한 번으로 가져와 바로 학습을 시작하세요.' },
  ],
}

const LANDING_HOWTO = {
  en: [
    { name: 'Create Your Deck', text: 'Sign up for free and create your first flashcard deck. Add cards with front and back content, organize with tags.' },
    { name: 'Study with Smart Modes', text: 'Choose from 5 study modes including SRS, Cramming, Quiz, Matching, and Writing. The SRS algorithm optimizes your review schedule.' },
    { name: 'Track Your Progress', text: 'Monitor your learning with detailed analytics. See your study streaks, retention rates, and mastery levels for each deck.' },
  ],
  ko: [
    { name: '덱 만들기', text: '무료로 가입하고 첫 플래시카드 덱을 만드세요. 앞면과 뒷면 내용이 있는 카드를 추가하고 태그로 정리하세요.' },
    { name: '스마트 모드로 학습', text: 'SRS, 벼락치기, 퀴즈, 매칭, 쓰기 등 5가지 학습 모드 중 선택하세요. SRS 알고리즘이 복습 일정을 최적화합니다.' },
    { name: '진행 상황 추적', text: '상세한 분석으로 학습을 모니터링하세요. 학습 연속일, 기억 유지율, 각 덱의 숙달도를 확인하세요.' },
  ],
}

// ─── Bot Detection (SEO + AEO) ───────────────────────────────────────────────
// Search engine crawlers + social media bots + AI answer engines
const BOT_UA = new RegExp([
  // Search engines
  'googlebot', 'google-inspectiontool', 'storebot-google',
  'bingbot', 'msnbot',
  'yandex', 'yandexbot',
  'baiduspider', 'baidu',
  'duckduckbot',
  'slurp',                    // Yahoo
  'naverbot', 'yeti',         // Naver
  'daum',                     // Daum/Kakao
  'sogou',
  'seznam',
  'applebot',
  'petalbot',                 // Huawei
  'qwantify',
  // Social media / link preview bots
  'twitterbot',
  'facebookexternalhit', 'facebookcatalog',
  'linkedinbot',
  'slackbot',
  'whatsapp',
  'telegrambot',
  'discordbot',
  'pinterestbot',
  'redditbot',
  'skypeuripreview',
  'kakaotalk-scrap',
  'line-poker',               // LINE
  // AI answer engines (AEO)
  'chatgpt-user',
  'gptbot',
  'oai-searchbot',
  'perplexitybot',
  'claudebot', 'claude-web',
  'google-extended',
  'cohere-ai',
  'bytespider',               // TikTok/ByteDance
  'amazonbot',
  'anthropic-ai',
  'meta-externalagent',
  'iaskspider',               // iAsk.Ai
  'youbot',                   // You.com
  // SEO tools
  'semrushbot', 'ahrefsbot', 'mj12bot', 'dotbot',
  'screaming frog',
  // Generic
  'crawler', 'spider', 'ia_archiver',
  'headlesschrome', 'phantomjs', 'prerender',
].join('|'), 'i')

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSupabaseRestUrl(env) {
  return env.SUPABASE_URL
    ? `${env.SUPABASE_URL}/rest/v1`
    : 'https://ixdapelfikaneexnskfm.supabase.co/rest/v1'
}

function getSupabaseAnonKey(env) {
  return env.SUPABASE_ANON_KEY || ''
}

function escapeHtml(str) {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function buildHreflangTags(basePath, queryParam) {
  return SUPPORTED_LOCALES.map(
    (l) => `<link rel="alternate" hreflang="${l}" href="${SITE_URL}${basePath}${queryParam ? `?lang=${l}` : ''}">`
  ).join('\n') + `\n<link rel="alternate" hreflang="x-default" href="${SITE_URL}${basePath}">`
}

function buildOgLocaleAlternates(lang) {
  return SUPPORTED_LOCALES
    .filter((l) => l !== lang)
    .map((l) => `<meta property="og:locale:alternate" content="${OG_LOCALE_MAP[l] || `${l}_${l.toUpperCase()}`}">`)
    .join('\n')
}

function buildCommonHead(lang) {
  return `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<meta name="theme-color" content="#2563eb">
<link rel="icon" type="image/png" href="/favicon.png">
<meta name="author" content="${BRAND_NAME}">`
}

function buildOrganizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: BRAND_NAME,
    url: SITE_URL,
    logo: { '@type': 'ImageObject', url: DEFAULT_OG_IMAGE, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT },
    sameAs: [
      'https://twitter.com/reeeeecallstudy',
      'https://x.com/reeeeecallstudy',
    ],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      email: 'admin@reeeeecallstudy.xyz',
      availableLanguage: ['English', 'Korean', 'Chinese', 'Japanese', 'Spanish', 'Vietnamese', 'Thai', 'Indonesian'],
    },
  }
}

function buildWebSiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: BRAND_NAME,
    url: SITE_URL,
    inLanguage: SUPPORTED_LOCALES,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/insight?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  }
}

// ─── Semantic HTML from content blocks ───────────────────────────────────────

function renderBlocksToHtml(blocks) {
  const parts = []
  for (const block of blocks) {
    if (!block.props) continue
    const p = block.props
    switch (block.type) {
      case 'heading':
        parts.push(`<h2>${escapeHtml(p.text)}</h2>`)
        break
      case 'paragraph':
        parts.push(`<p>${escapeHtml(p.text)}</p>`)
        break
      case 'blockquote':
        parts.push(`<blockquote><p>${escapeHtml(p.text)}</p>${p.attribution ? `<footer>— ${escapeHtml(p.attribution)}</footer>` : ''}</blockquote>`)
        break
      case 'statistics':
        if (p.items) {
          parts.push('<dl>' + p.items.map((it) => `<dt>${escapeHtml(it.label || '')}</dt><dd>${escapeHtml(it.value || '')}</dd>`).join('') + '</dl>')
        }
        break
      case 'feature_cards':
        if (p.items) {
          parts.push('<ul>' + p.items.map((it) => `<li><strong>${escapeHtml(it.title || '')}</strong>: ${escapeHtml(it.description || '')}</li>`).join('') + '</ul>')
        }
        break
      case 'numbered_list':
        if (p.items) {
          parts.push('<ol>' + p.items.map((it) => `<li><strong>${escapeHtml(it.heading || '')}</strong> ${escapeHtml(it.description || '')}</li>`).join('') + '</ol>')
        }
        break
      case 'highlight_box':
        parts.push(`<aside><h3>${escapeHtml(p.title || '')}</h3><p>${escapeHtml(p.description || '')}</p></aside>`)
        break
      case 'image':
        parts.push(`<figure>${p.src ? `<img src="${escapeHtml(p.src)}" alt="${escapeHtml(p.alt || '')}" loading="lazy">` : ''}${p.caption ? `<figcaption>${escapeHtml(p.caption)}</figcaption>` : ''}</figure>`)
        break
      case 'cta':
        parts.push(`<section><h3>${escapeHtml(p.title || '')}</h3><p>${escapeHtml(p.description || '')}</p>${p.buttonUrl ? `<a href="${escapeHtml(p.buttonUrl)}">${escapeHtml(p.buttonText || 'Learn More')}</a>` : ''}</section>`)
        break
      default:
        // hero block — extract title/subtitle
        if (p.title) parts.push(`<p><strong>${escapeHtml(p.title)}</strong></p>`)
        if (p.subtitle) parts.push(`<p>${escapeHtml(p.subtitle)}</p>`)
        if (p.description) parts.push(`<p>${escapeHtml(p.description)}</p>`)
        if (p.text) parts.push(`<p>${escapeHtml(p.text)}</p>`)
        break
    }
  }
  return parts.join('\n')
}

function extractPlainTextFromBlocks(blocks) {
  const texts = []
  for (const block of blocks) {
    if (!block.props) continue
    const p = block.props
    if (p.text) texts.push(p.text)
    if (p.title) texts.push(p.title)
    if (p.subtitle) texts.push(p.subtitle)
    if (p.description) texts.push(p.description)
    if (p.items) {
      for (const item of p.items) {
        if (item.label) texts.push(item.label)
        if (item.value) texts.push(item.value)
        if (item.heading) texts.push(item.heading)
        if (item.description) texts.push(item.description)
        if (item.title) texts.push(item.title)
      }
    }
  }
  return texts.join(' ')
}

// ─── Content Detail Bot Handler ──────────────────────────────────────────────

async function handleContentDetailBot(slug, url, env) {
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
  const wordCount = Math.round((article.reading_time_minutes || 5) * 250)
  const bodyHtml = renderBlocksToHtml(blocks)

  // Build multiple JSON-LD schemas
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    image: { '@type': 'ImageObject', url: ogImage, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT },
    datePublished: article.published_at,
    dateModified: article.updated_at,
    wordCount,
    keywords: tags.join(', '),
    author: { '@type': 'Organization', name: article.author_name || BRAND_NAME, url: SITE_URL },
    publisher: {
      '@type': 'Organization',
      name: BRAND_NAME,
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: DEFAULT_OG_IMAGE, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT },
    },
    inLanguage: article.locale,
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/insight/${slug}` },
  }

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: BRAND_NAME, item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: LIST_TITLES[article.locale]?.split(' — ')[0] || 'Learning Insights', item: `${SITE_URL}/insight` },
      { '@type': 'ListItem', position: 3, name: article.title, item: `${SITE_URL}/insight/${slug}` },
    ],
  }

  const learningResourceJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: title,
    description,
    image: { '@type': 'ImageObject', url: ogImage, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT },
    datePublished: article.published_at,
    dateModified: article.updated_at,
    educationalLevel: 'beginner',
    learningResourceType: 'Article',
    timeRequired: `PT${article.reading_time_minutes || 5}M`,
    keywords: tags.join(', '),
    inLanguage: article.locale,
    isAccessibleForFree: true,
    author: { '@type': 'Organization', name: article.author_name || BRAND_NAME, url: SITE_URL },
    publisher: {
      '@type': 'Organization',
      name: BRAND_NAME,
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: DEFAULT_OG_IMAGE, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/insight/${slug}` },
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['article h1', 'article h2', 'article p', 'article li', 'article blockquote'],
    },
  }

  const articleTagsMeta = tags.map((t) => `<meta property="article:tag" content="${escapeHtml(t)}">`).join('\n')

  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(article.locale)}">
<head>
${buildCommonHead(article.locale)}
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="keywords" content="${escapeHtml(tags.join(', '))}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${SITE_URL}/insight/${escapeHtml(slug)}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta property="og:image:width" content="${OG_IMAGE_WIDTH}">
<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}">
<meta property="og:image:alt" content="${escapeHtml(title)}">
<meta property="og:site_name" content="${BRAND_NAME}">
<meta property="og:locale" content="${OG_LOCALE_MAP[article.locale] || 'en_US'}">
${buildOgLocaleAlternates(article.locale)}
${article.published_at ? `<meta property="article:published_time" content="${escapeHtml(article.published_at)}">` : ''}
${article.updated_at ? `<meta property="article:modified_time" content="${escapeHtml(article.updated_at)}">` : ''}
<meta property="article:section" content="${escapeHtml(articleSection)}">
<meta property="article:author" content="${escapeHtml(article.author_name || BRAND_NAME)}">
${articleTagsMeta}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="${TWITTER_HANDLE}">
<meta name="twitter:creator" content="${TWITTER_HANDLE}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">
<meta name="twitter:image:alt" content="${escapeHtml(title)}">
<link rel="canonical" href="${SITE_URL}/insight/${escapeHtml(slug)}">
<link rel="alternate" type="application/rss+xml" title="${BRAND_NAME} Learning Insights" href="${SITE_URL}/feed.xml${lang !== 'en' ? `?lang=${lang}` : ''}">
${buildHreflangTags(`/insight/${escapeHtml(slug)}`, true)}
<script type="application/ld+json">${JSON.stringify(articleJsonLd)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumbJsonLd)}</script>
<script type="application/ld+json">${JSON.stringify(learningResourceJsonLd)}</script>
<script type="application/ld+json">${JSON.stringify(buildOrganizationJsonLd())}</script>
</head>
<body>
<nav aria-label="breadcrumb"><ol><li><a href="${SITE_URL}">${BRAND_NAME}</a></li><li><a href="${SITE_URL}/insight">${LIST_TITLES[article.locale]?.split(' — ')[0] || 'Learning Insights'}</a></li><li>${escapeHtml(article.title)}</li></ol></nav>
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
</footer>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Language': article.locale,
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'X-Robots-Tag': 'index, follow, max-image-preview:large',
      'Link': `<${SITE_URL}/insight>; rel="up", <${SITE_URL}/feed.xml>; rel="alternate"; type="application/rss+xml"`,
    },
  })
}

// ─── Content List Bot Handler ────────────────────────────────────────────────

async function handleContentListBot(url, env) {
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

  const collectionJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: listTitle,
    description: listDesc,
    url: `${SITE_URL}/insight`,
    image: { '@type': 'ImageObject', url: DEFAULT_OG_IMAGE, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT },
    inLanguage: lang,
    numberOfItems: articles.length,
    publisher: {
      '@type': 'Organization',
      name: BRAND_NAME,
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: DEFAULT_OG_IMAGE, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/insight` },
  }

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: articles.slice(0, 30).map((a, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}/insight/${a.slug}`,
      name: a.title,
    })),
  }

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

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
${buildCommonHead(lang)}
<title>${escapeHtml(listTitle)}</title>
<meta name="description" content="${escapeHtml(listDesc)}">
<meta name="keywords" content="spaced repetition, flashcards, study tips, learning strategies, active recall, SRS, memory techniques">
<meta property="og:title" content="${escapeHtml(listTitle)}">
<meta property="og:description" content="${escapeHtml(listDesc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE_URL}/insight">
<meta property="og:image" content="${DEFAULT_OG_IMAGE}">
<meta property="og:image:width" content="${OG_IMAGE_WIDTH}">
<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}">
<meta property="og:image:alt" content="${escapeHtml(listTitle)}">
<meta property="og:site_name" content="${BRAND_NAME}">
<meta property="og:locale" content="${OG_LOCALE_MAP[lang] || 'en_US'}">
${buildOgLocaleAlternates(lang)}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="${TWITTER_HANDLE}">
<meta name="twitter:title" content="${escapeHtml(listTitle)}">
<meta name="twitter:description" content="${escapeHtml(listDesc)}">
<meta name="twitter:image" content="${DEFAULT_OG_IMAGE}">
<meta name="twitter:image:alt" content="${escapeHtml(listTitle)}">
<link rel="canonical" href="${SITE_URL}/insight">
<link rel="alternate" type="application/rss+xml" title="${BRAND_NAME} Learning Insights" href="${SITE_URL}/feed.xml${lang !== 'en' ? `?lang=${lang}` : ''}">
<link rel="alternate" type="application/atom+xml" title="${BRAND_NAME} Learning Insights" href="${SITE_URL}/feed.atom${lang !== 'en' ? `?lang=${lang}` : ''}">
${buildHreflangTags('/insight', true)}
<script type="application/ld+json">${JSON.stringify(collectionJsonLd)}</script>
<script type="application/ld+json">${JSON.stringify(itemListJsonLd)}</script>
<script type="application/ld+json">${JSON.stringify(buildOrganizationJsonLd())}</script>
<script type="application/ld+json">${JSON.stringify(buildWebSiteJsonLd())}</script>
</head>
<body>
<nav aria-label="breadcrumb"><ol><li><a href="${SITE_URL}">${BRAND_NAME}</a></li><li>${LIST_TITLES[lang]?.split(' — ')[0] || 'Learning Insights'}</li></ol></nav>
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
</footer>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Language': lang,
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'X-Robots-Tag': 'index, follow, max-image-preview:large',
    },
  })
}

// ─── Content Bot Request Router ──────────────────────────────────────────────

async function handleContentBotRequest(url, env) {
  const anonKey = getSupabaseAnonKey(env)
  if (!anonKey) return new Response('Bot prerendering not configured', { status: 500 })

  const slugMatch = url.pathname.match(/^\/insight\/(.+)$/)
  if (slugMatch) {
    const result = await handleContentDetailBot(slugMatch[1], url, env)
    if (result) return result
    return new Response('Not Found', { status: 404 })
  }

  return handleContentListBot(url, env)
}

// ─── Landing Page Bot Handler ────────────────────────────────────────────────

async function handleLandingBotRequest(url) {
  const lang = url.searchParams.get('lang') || 'en'
  const pageTitle = LANDING_TITLES[lang] || LANDING_TITLES.en
  const pageDesc = LANDING_DESCS[lang] || LANDING_DESCS.en

  const webAppJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: BRAND_NAME,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web',
    description: pageDesc,
    url: SITE_URL,
    image: { '@type': 'ImageObject', url: DEFAULT_OG_IMAGE, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT },
    inLanguage: lang,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: {
      '@type': 'Organization',
      name: BRAND_NAME,
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: DEFAULT_OG_IMAGE, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT },
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.8',
      reviewCount: '150',
      bestRating: '5',
    },
  }

  // FAQ structured data
  const faqItems = LANDING_FAQ[lang] || LANDING_FAQ.en
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

  // HowTo structured data
  const howToSteps = LANDING_HOWTO[lang] || LANDING_HOWTO.en
  const howToJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: lang === 'ko' ? '스마트 학습 시작하기' : 'How to Start Smart Learning',
    totalTime: 'PT3M',
    step: howToSteps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  }

  const faqHtml = faqItems.map((f) =>
    `<details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`
  ).join('\n')

  const howToHtml = howToSteps.map((s, i) =>
    `<li><strong>${escapeHtml(s.name)}</strong>: ${escapeHtml(s.text)}</li>`
  ).join('\n')

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
${buildCommonHead(lang)}
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${escapeHtml(pageDesc)}">
<meta name="keywords" content="spaced repetition, flashcards, SRS, study app, learning platform, memorization, active recall, flashcard app, free study tool">
<meta property="og:title" content="${escapeHtml(pageTitle)}">
<meta property="og:description" content="${escapeHtml(pageDesc)}">
<meta property="og:image" content="${DEFAULT_OG_IMAGE}">
<meta property="og:image:width" content="${OG_IMAGE_WIDTH}">
<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}">
<meta property="og:image:alt" content="${escapeHtml(pageTitle)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE_URL}/landing">
<meta property="og:site_name" content="${BRAND_NAME}">
<meta property="og:locale" content="${OG_LOCALE_MAP[lang] || 'en_US'}">
${buildOgLocaleAlternates(lang)}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="${TWITTER_HANDLE}">
<meta name="twitter:creator" content="${TWITTER_HANDLE}">
<meta name="twitter:title" content="${escapeHtml(pageTitle)}">
<meta name="twitter:description" content="${escapeHtml(pageDesc)}">
<meta name="twitter:image" content="${DEFAULT_OG_IMAGE}">
<meta name="twitter:image:alt" content="${escapeHtml(pageTitle)}">
<link rel="canonical" href="${SITE_URL}/landing">
<link rel="alternate" type="application/rss+xml" title="${BRAND_NAME} Learning Insights" href="${SITE_URL}/feed.xml${lang !== 'en' ? `?lang=${lang}` : ''}">
<link rel="alternate" type="application/atom+xml" title="${BRAND_NAME} Learning Insights" href="${SITE_URL}/feed.atom${lang !== 'en' ? `?lang=${lang}` : ''}">
<link rel="search" type="application/opensearchdescription+xml" title="${BRAND_NAME}" href="${SITE_URL}/opensearch.xml">
${buildHreflangTags('/landing', true)}
<script type="application/ld+json">${JSON.stringify(webAppJsonLd)}</script>
<script type="application/ld+json">${JSON.stringify(faqJsonLd)}</script>
<script type="application/ld+json">${JSON.stringify(howToJsonLd)}</script>
<script type="application/ld+json">${JSON.stringify(buildOrganizationJsonLd())}</script>
<script type="application/ld+json">${JSON.stringify(buildWebSiteJsonLd())}</script>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Course',
  name: lang === 'ko' ? '간격 반복 학습 마스터하기' : 'Master Spaced Repetition Learning',
  description: lang === 'ko' ? '과학적으로 검증된 간격 반복(SRS) 알고리즘으로 어떤 과목이든 더 빠르게 암기하고 오래 기억하세요.' : 'Learn to memorize any subject faster and retain it longer with scientifically proven spaced repetition (SRS) algorithm.',
  provider: { '@type': 'Organization', name: BRAND_NAME, url: SITE_URL },
  isAccessibleForFree: true,
  courseMode: 'online',
  inLanguage: SUPPORTED_LOCALES,
  educationalLevel: 'beginner',
  hasCourseInstance: {
    '@type': 'CourseInstance',
    courseMode: 'online',
    courseWorkload: 'PT5M',
  },
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
})}</script>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'ProfilePage',
  mainEntity: {
    '@type': 'Organization',
    name: BRAND_NAME,
    url: SITE_URL,
    description: pageDesc,
    logo: DEFAULT_OG_IMAGE,
    sameAs: ['https://twitter.com/reeeeecallstudy', 'https://x.com/reeeeecallstudy'],
  },
  hasPart: [
    { '@type': 'Article', url: `${SITE_URL}/insight`, name: lang === 'ko' ? '학습 인사이트' : 'Learning Insights' },
  ],
})}</script>
</head>
<body>
<main>
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
</footer>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Language': lang,
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'X-Robots-Tag': 'index, follow, max-image-preview:large',
    },
  })
}

// ─── Marketplace Listing Bot Handler ─────────────────────────────────────────

async function handleListingBotRequest(listingId, url, env) {
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

  const datasetJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: listing.title,
    description,
    url: `${SITE_URL}/d/${listingId}`,
    keywords: tags.join(', '),
    creator: {
      '@type': listing.owner_is_official ? 'Organization' : 'Person',
      name: listing.owner_name || BRAND_NAME,
    },
    publisher: {
      '@type': 'Organization',
      name: BRAND_NAME,
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: DEFAULT_OG_IMAGE, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT },
    },
    datePublished: listing.created_at,
    inLanguage: lang,
    isAccessibleForFree: true,
  }

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: BRAND_NAME, item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: lang === 'ko' ? '마켓플레이스' : 'Marketplace', item: `${SITE_URL}/landing` },
      { '@type': 'ListItem', position: 3, name: listing.title, item: `${SITE_URL}/d/${listingId}` },
    ],
  }

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
${buildCommonHead(lang)}
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="keywords" content="${escapeHtml(tags.join(', '))}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE_URL}/d/${escapeHtml(listingId)}">
<meta property="og:image" content="${DEFAULT_OG_IMAGE}">
<meta property="og:image:width" content="${OG_IMAGE_WIDTH}">
<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}">
<meta property="og:site_name" content="${BRAND_NAME}">
<meta property="og:locale" content="${OG_LOCALE_MAP[lang] || 'en_US'}">
${buildOgLocaleAlternates(lang)}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="${TWITTER_HANDLE}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${DEFAULT_OG_IMAGE}">
<link rel="canonical" href="${SITE_URL}/d/${escapeHtml(listingId)}">
${buildHreflangTags(`/d/${escapeHtml(listingId)}`, true)}
<script type="application/ld+json">${JSON.stringify(datasetJsonLd)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumbJsonLd)}</script>
<script type="application/ld+json">${JSON.stringify(buildOrganizationJsonLd())}</script>
</head>
<body>
<nav aria-label="breadcrumb"><ol><li><a href="${SITE_URL}">${BRAND_NAME}</a></li><li><a href="${SITE_URL}/landing">${lang === 'ko' ? '마켓플레이스' : 'Marketplace'}</a></li><li>${escapeHtml(listing.title)}</li></ol></nav>
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
</footer>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Language': lang,
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'X-Robots-Tag': 'index, follow',
    },
  })
}

// ─── Dynamic Sitemap ─────────────────────────────────────────────────────────

async function handleSitemap(env) {
  const restUrl = getSupabaseRestUrl(env)
  const anonKey = getSupabaseAnonKey(env)

  let contentEntries = ''
  let listingEntries = ''

  if (anonKey) {
    // Fetch content articles (include thumbnail for image sitemap)
    const contentRes = await fetch(
      `${restUrl}/contents?is_published=eq.true&select=slug,locale,updated_at,title,thumbnail_url,og_image_url&order=published_at.desc`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
    )
    const contentData = await contentRes.json()
    const articles = contentData || []

    // Group by slug for hreflang + image data
    const slugMap = {}
    for (const a of articles) {
      if (!slugMap[a.slug]) slugMap[a.slug] = { locales: {}, title: a.title, image: a.og_image_url || a.thumbnail_url }
      slugMap[a.slug].locales[a.locale] = a.updated_at
      if (!slugMap[a.slug].image && (a.og_image_url || a.thumbnail_url)) {
        slugMap[a.slug].image = a.og_image_url || a.thumbnail_url
      }
    }

    for (const [slug, info] of Object.entries(slugMap)) {
      const lastmod = Object.values(info.locales).sort().pop()
      const imageTag = info.image
        ? `\n    <image:image>\n      <image:loc>${info.image}</image:loc>\n      <image:title>${slug.replace(/-/g, ' ')}</image:title>\n    </image:image>`
        : ''
      contentEntries += `  <url>
    <loc>${SITE_URL}/insight/${slug}</loc>
    <lastmod>${new Date(lastmod).toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>${imageTag}
${SUPPORTED_LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL}/insight/${slug}?lang=${l}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/insight/${slug}"/>
  </url>\n`
    }

    // Fetch marketplace listings
    try {
      const listingRes = await fetch(
        `${restUrl}/marketplace_listings?is_active=eq.true&select=id,updated_at&order=created_at.desc&limit=500`,
        { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
      )
      const listingData = await listingRes.json()
      const listings = listingData || []

      for (const l of listings) {
        const lastmod = l.updated_at ? new Date(l.updated_at).toISOString().split('T')[0] : ''
        listingEntries += `  <url>
    <loc>${SITE_URL}/d/${l.id}</loc>
${lastmod ? `    <lastmod>${lastmod}</lastmod>` : ''}
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
${SUPPORTED_LOCALES.map((ll) => `    <xhtml:link rel="alternate" hreflang="${ll}" href="${SITE_URL}/d/${l.id}?lang=${ll}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/d/${l.id}"/>
  </url>\n`
      }
    } catch {
      // listings table may not exist yet — skip
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${SITE_URL}/landing</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
${SUPPORTED_LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL}/landing?lang=${l}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/landing"/>
  </url>
  <url>
    <loc>${SITE_URL}/insight</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
${SUPPORTED_LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL}/insight?lang=${l}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/insight"/>
  </url>
  <url>
    <loc>${SITE_URL}/docs/api</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
${contentEntries}${listingEntries}</urlset>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  })
}

// ─── RSS Feed ────────────────────────────────────────────────────────────────

async function handleRSSFeed(env, format = 'rss', lang = 'en') {
  const restUrl = getSupabaseRestUrl(env)
  const anonKey = getSupabaseAnonKey(env)
  if (!anonKey) return new Response('Feed not configured', { status: 500 })

  const res = await fetch(
    `${restUrl}/contents?is_published=eq.true&locale=eq.${lang}&select=slug,title,subtitle,meta_description,published_at,updated_at,tags,author_name,thumbnail_url,reading_time_minutes&order=published_at.desc&limit=50`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
  )
  const articles = (await res.json()) || []

  if (format === 'json') {
    // JSON Feed (https://jsonfeed.org/)
    const jsonFeed = {
      version: 'https://jsonfeed.org/version/1.1',
      title: `${BRAND_NAME} — Learning Insights`,
      home_page_url: `${SITE_URL}/insight`,
      feed_url: `${SITE_URL}/feed.json`,
      description: 'Science-backed learning strategies, spaced repetition tips, and study techniques.',
      icon: `${SITE_URL}/favicon.png`,
      favicon: `${SITE_URL}/favicon.png`,
      language: 'en',
      authors: [{ name: BRAND_NAME, url: SITE_URL }],
      items: articles.map((a) => ({
        id: `${SITE_URL}/insight/${a.slug}`,
        url: `${SITE_URL}/insight/${a.slug}`,
        title: a.title,
        summary: a.meta_description || a.subtitle || '',
        date_published: a.published_at,
        date_modified: a.updated_at,
        authors: [{ name: a.author_name || BRAND_NAME }],
        tags: a.tags || [],
        image: a.thumbnail_url || DEFAULT_OG_IMAGE,
      })),
    }
    return new Response(JSON.stringify(jsonFeed, null, 2), {
      headers: {
        'Content-Type': 'application/feed+json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    })
  }

  if (format === 'atom') {
    const updated = articles[0]?.updated_at || new Date().toISOString()
    const entries = articles.map((a) => {
      const pubDate = a.published_at || new Date().toISOString()
      return `  <entry>
    <title>${escapeHtml(a.title)}</title>
    <link href="${SITE_URL}/insight/${a.slug}" rel="alternate" type="text/html"/>
    <id>${SITE_URL}/insight/${a.slug}</id>
    <published>${pubDate}</published>
    <updated>${a.updated_at || pubDate}</updated>
    <author><name>${escapeHtml(a.author_name || BRAND_NAME)}</name></author>
    <summary type="text">${escapeHtml(a.meta_description || a.subtitle || '')}</summary>
${(a.tags || []).map((t) => `    <category term="${escapeHtml(t)}"/>`).join('\n')}
  </entry>`
    }).join('\n')

    const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${BRAND_NAME} — Learning Insights</title>
  <subtitle>Science-backed learning strategies, spaced repetition tips, and study techniques.</subtitle>
  <link href="${SITE_URL}/feed.atom" rel="self" type="application/atom+xml"/>
  <link href="${SITE_URL}/insight" rel="alternate" type="text/html"/>
  <id>${SITE_URL}/insight</id>
  <updated>${updated}</updated>
  <author><name>${BRAND_NAME}</name></author>
  <icon>${SITE_URL}/favicon.png</icon>
  <logo>${DEFAULT_OG_IMAGE}</logo>
  <rights>Copyright ${new Date().getFullYear()} ${BRAND_NAME}</rights>
  <generator>ReeeeecallStudy Content Pipeline</generator>
${entries}
</feed>`

    return new Response(atom, {
      headers: {
        'Content-Type': 'application/atom+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    })
  }

  // RSS 2.0
  const items = articles.map((a) => {
    const pubDate = a.published_at ? new Date(a.published_at).toUTCString() : ''
    return `    <item>
      <title>${escapeHtml(a.title)}</title>
      <link>${SITE_URL}/insight/${a.slug}</link>
      <guid isPermaLink="true">${SITE_URL}/insight/${a.slug}</guid>
      <description>${escapeHtml(a.meta_description || a.subtitle || '')}</description>
      <pubDate>${pubDate}</pubDate>
      <author>admin@reeeeecallstudy.xyz (${escapeHtml(a.author_name || BRAND_NAME)})</author>
${(a.tags || []).map((t) => `      <category>${escapeHtml(t)}</category>`).join('\n')}
${a.thumbnail_url ? `      <enclosure url="${escapeHtml(a.thumbnail_url)}" type="image/jpeg"/>` : ''}
      <source url="${SITE_URL}/feed.xml">${BRAND_NAME} Learning Insights</source>
    </item>`
  }).join('\n')

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${BRAND_NAME} — Learning Insights</title>
    <link>${SITE_URL}/insight</link>
    <description>Science-backed learning strategies, spaced repetition tips, and study techniques. Free articles to help you study smarter and remember longer.</description>
    <language>en</language>
    <lastBuildDate>${articles[0]?.published_at ? new Date(articles[0].published_at).toUTCString() : new Date().toUTCString()}</lastBuildDate>
    <managingEditor>admin@reeeeecallstudy.xyz (${BRAND_NAME})</managingEditor>
    <webMaster>admin@reeeeecallstudy.xyz (${BRAND_NAME})</webMaster>
    <copyright>Copyright ${new Date().getFullYear()} ${BRAND_NAME}</copyright>
    <category>Education</category>
    <category>Learning</category>
    <category>Study Tips</category>
    <generator>ReeeeecallStudy Content Pipeline</generator>
    <docs>https://www.rssboard.org/rss-specification</docs>
    <ttl>60</ttl>
    <image>
      <url>${DEFAULT_OG_IMAGE}</url>
      <title>${BRAND_NAME}</title>
      <link>${SITE_URL}</link>
      <width>144</width>
      <height>144</height>
    </image>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`

  return new Response(rss, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  })
}

// ─── Main Worker ─────────────────────────────────────────────────────────────

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runContentPipeline(env, event.cron))
  },

  async fetch(request, env) {
    const url = new URL(request.url)
    const ua = request.headers.get('user-agent') || ''

    // Trailing slash redirect — prevent duplicate content (except root)
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      const cleanUrl = new URL(url)
      cleanUrl.pathname = url.pathname.slice(0, -1)
      return new Response(null, {
        status: 301,
        headers: { Location: cleanUrl.toString() },
      })
    }

    // Static HTML pages (privacy policy, terms) — serve directly from assets
    if (url.pathname.endsWith('.html') && url.pathname !== '/index.html') {
      return env.ASSETS.fetch(request)
    }

    // Dynamic sitemap (always available)
    if (url.pathname === '/sitemap.xml') {
      return handleSitemap(env)
    }

    // RSS / Atom / JSON feeds (supports ?lang=ko etc.)
    const feedLang = url.searchParams.get('lang') || 'en'
    if (url.pathname === '/feed.xml' || url.pathname === '/rss.xml' || url.pathname === '/feed') {
      return handleRSSFeed(env, 'rss', feedLang)
    }
    if (url.pathname === '/feed.atom' || url.pathname === '/atom.xml') {
      return handleRSSFeed(env, 'atom', feedLang)
    }
    if (url.pathname === '/feed.json') {
      return handleRSSFeed(env, 'json', feedLang)
    }

    // IndexNow key verification (serves the key file for search engine validation)
    if (env.INDEXNOW_KEY && url.pathname === `/${env.INDEXNOW_KEY}.txt`) {
      return new Response(env.INDEXNOW_KEY, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
      })
    }

    // llms.txt discovery — add header for AI engines
    if (url.pathname === '/llms.txt' || url.pathname === '/llms-full.txt') {
      // Served from static assets, but add cache headers
      // Fall through to asset serving
    }

    // robots.txt — serve dynamically to ensure consistency
    if (url.pathname === '/robots.txt') {
      const robotsTxt = `# ReeeeecallStudy robots.txt
User-agent: *
Allow: /landing
Allow: /insight
Allow: /insight/*
Allow: /d/
Allow: /d/*
Disallow: /docs/
Disallow: /auth/
Disallow: /decks/
Disallow: /settings
Disallow: /history
Disallow: /quick-study
Disallow: /marketplace
Disallow: /my-shares
Disallow: /templates
Disallow: /admin
Disallow: /api-docs
Disallow: /api/
Disallow: /dashboard

User-agent: Bingbot
Crawl-delay: 2
Allow: /landing
Allow: /insight
Allow: /insight/*
Allow: /d/
Allow: /d/*
Disallow: /docs/
Disallow: /auth/
Disallow: /decks/
Disallow: /settings
Disallow: /history
Disallow: /quick-study
Disallow: /marketplace
Disallow: /my-shares
Disallow: /templates
Disallow: /admin
Disallow: /api-docs
Disallow: /api/
Disallow: /dashboard

User-agent: ChatGPT-User
Allow: /landing
Allow: /insight
Allow: /insight/*
Allow: /d/
Allow: /d/*
Disallow: /

User-agent: GPTBot
Allow: /landing
Allow: /insight
Allow: /insight/*
Allow: /d/
Allow: /d/*
Disallow: /

User-agent: OAI-SearchBot
Allow: /landing
Allow: /insight
Allow: /insight/*
Allow: /d/
Allow: /d/*
Disallow: /

User-agent: PerplexityBot
Allow: /landing
Allow: /insight
Allow: /insight/*
Allow: /d/
Allow: /d/*
Disallow: /

User-agent: ClaudeBot
Allow: /landing
Allow: /insight
Allow: /insight/*
Allow: /d/
Allow: /d/*
Disallow: /

User-agent: Google-Extended
Allow: /landing
Allow: /insight
Allow: /insight/*
Allow: /d/
Allow: /d/*
Disallow: /

User-agent: Bytespider
Allow: /landing
Allow: /insight
Allow: /insight/*
Allow: /d/
Allow: /d/*
Disallow: /

User-agent: Amazonbot
Allow: /landing
Allow: /insight
Allow: /insight/*
Allow: /d/
Allow: /d/*
Disallow: /

User-agent: Meta-ExternalAgent
Allow: /landing
Allow: /insight
Allow: /insight/*
Allow: /d/
Allow: /d/*
Disallow: /

User-agent: Cohere-ai
Allow: /landing
Allow: /insight
Allow: /insight/*
Allow: /d/
Allow: /d/*
Disallow: /

User-agent: YouBot
Allow: /landing
Allow: /insight
Allow: /insight/*
Allow: /d/
Allow: /d/*
Disallow: /

User-agent: iaskspider
Allow: /landing
Allow: /insight
Allow: /insight/*
Allow: /d/
Allow: /d/*
Disallow: /

Sitemap: ${SITE_URL}/sitemap.xml

# AI/LLM context files
# https://llmstxt.org/
# llms.txt: ${SITE_URL}/llms.txt
# llms-full.txt: ${SITE_URL}/llms-full.txt`

      return new Response(robotsTxt, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
        },
      })
    }

    // Bot prerendering for SEO + AEO
    if (BOT_UA.test(ua)) {
      // Content pages
      if (url.pathname === '/insight' || url.pathname.startsWith('/insight/')) {
        return handleContentBotRequest(url, env)
      }
      // Landing page
      if (url.pathname === '/' || url.pathname === '/landing') {
        return handleLandingBotRequest(url)
      }
      // Marketplace listing pages
      const listingMatch = url.pathname.match(/^\/d\/(.+)$/)
      if (listingMatch) {
        const result = await handleListingBotRequest(listingMatch[1], url, env)
        if (result) return result
      }
      // API docs (public)
      if (url.pathname === '/docs/api') {
        // Fall through to SPA asset serving
      }
      // Bot accessing non-public routes → proper 404 to prevent soft 404 indexing
      else if (!url.pathname.match(/^\/($|landing|insight|d\/|docs\/api|auth\/)/) && !url.pathname.match(/\.\w+$/)) {
        return new Response(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="robots" content="noindex, nofollow">
<title>404 — Page Not Found | ${BRAND_NAME}</title>
<link rel="canonical" href="${SITE_URL}/landing">
</head><body>
<h1>404 — Page Not Found</h1>
<p>The page you are looking for does not exist.</p>
<p><a href="${SITE_URL}/landing">Go to ${BRAND_NAME} homepage</a></p>
<p><a href="${SITE_URL}/insight">Browse Learning Insights</a></p>
</body></html>`, {
          status: 404,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Robots-Tag': 'noindex, nofollow',
          },
        })
      }
    }

    // /api/* → Supabase Edge Function 프록시 (v1 엔드포인트 + doc/ui)
    if (url.pathname.startsWith('/api/')) {
      // OPTIONS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Max-Age': '86400',
          },
        })
      }

      const subpath = url.pathname.slice('/api/'.length)
      const target = `${SUPABASE_BASE}/${subpath}${url.search}`

      const headers = new Headers(request.headers)
      headers.delete('host')

      const res = await fetch(target, {
        method: request.method,
        headers,
        body: request.method !== 'GET' && request.method !== 'HEAD'
          ? request.body
          : undefined,
      })

      const responseHeaders = new Headers(res.headers)
      responseHeaders.set('Access-Control-Allow-Origin', '*')

      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
      })
    }

    // 정적 에셋 + SPA fallback은 assets 바인딩이 처리 (wrangler.jsonc의 assets 설정)
    return env.ASSETS.fetch(request)
  },
}
