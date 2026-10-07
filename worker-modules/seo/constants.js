// Keep in sync with packages/web/src/lib/seo-config.ts
// (web INDEXABLE_LOCALES / SUPPORTED_LOCALES mirror these two policy views).
//
// INDEXABLE_LOCALES = locales we emit indexing signals for (hreflang, JSON-LD
//   inLanguage, robots index). UI_LOCALES = all served languages (og:locale:alternate,
//   marketplace listing hreflang). Edit locale-policy.js to change either. The
//   per-locale content dicts below (LIST_TITLES, LANDING_*) keep ALL ui locales.
import { INDEXABLE_LOCALES, UI_LOCALES } from '../locale-policy.js'
import landing_en from '../../packages/web/public/locales/en/landing.json'
import landing_ko from '../../packages/web/public/locales/ko/landing.json'
import landing_zh from '../../packages/web/public/locales/zh/landing.json'
import landing_ja from '../../packages/web/public/locales/ja/landing.json'
import landing_vi from '../../packages/web/public/locales/vi/landing.json'
import landing_th from '../../packages/web/public/locales/th/landing.json'
import landing_id from '../../packages/web/public/locales/id/landing.json'
import landing_es from '../../packages/web/public/locales/es/landing.json'

export const SITE_URL = 'https://reeeeecallstudy.xyz'
export const BRAND_NAME = 'ReeeeecallStudy'
export const TWITTER_HANDLE = '@reeeeecallstudy'
export const CONTACT_EMAIL = 'admin@reeeeecallstudy.xyz'
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`
export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 630

// Re-exported so SEO modules read locale views from one place (not the policy
// directly). Use INDEXABLE_LOCALES for indexing signals, UI_LOCALES for served.
export { INDEXABLE_LOCALES, UI_LOCALES }

// Robots directives — emitted on BOTH <meta name="robots"> and the X-Robots-Tag
// header so the two channels never disagree. Non-indexable locales use NOINDEX.
export const ROBOTS_INDEX = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
export const ROBOTS_NOINDEX = 'noindex, follow'

export const OG_LOCALE_MAP = {
  en: 'en_US', ko: 'ko_KR', zh: 'zh_CN', ja: 'ja_JP',
  vi: 'vi_VN', th: 'th_TH', id: 'id_ID', es: 'es_ES',
}

export const LIST_TITLES = {
  en: 'Learning Insights — Science-Backed Study Strategies | ReeeeecallStudy',
  ko: '학습 인사이트 — 과학적 학습 전략 | ReeeeecallStudy',
  zh: '学习洞察 — 科学学习策略 | ReeeeecallStudy',
  ja: '学習インサイト — 科学的学習戦略 | ReeeeecallStudy',
  vi: 'Kiến thức Học tập — Chiến lược Học tập Khoa học | ReeeeecallStudy',
  th: 'ข้อมูลเชิงลึกด้านการเรียนรู้ — กลยุทธ์การเรียนรู้ทางวิทยาศาสตร์ | ReeeeecallStudy',
  id: 'Wawasan Belajar — Strategi Belajar Berbasis Sains | ReeeeecallStudy',
  es: 'Perspectivas de Aprendizaje — Estrategias de Estudio Científicas | ReeeeecallStudy',
}

export const LIST_DESCS = {
  en: 'Discover science-backed learning strategies, spaced repetition tips, and active recall techniques. Free articles to help you study smarter and remember longer.',
  ko: '과학적으로 검증된 학습 전략, 간격 반복 학습법, 능동적 회상 기법을 알아보세요. 더 스마트하게 공부하고 오래 기억하는 방법을 무료로 제공합니다.',
  zh: '探索经过科学验证的学习策略、间隔重复学习技巧和主动回忆技术。免费文章帮助你更聪明地学习、记忆更持久。',
  ja: '科学的に検証された学習戦略、間隔反復学習のコツ、アクティブリコール技法を発見しましょう。よりスマートに学び、より長く記憶するための無料記事。',
  vi: 'Khám phá các chiến lược học tập dựa trên khoa học, mẹo lặp lại ngắt quãng và kỹ thuật nhớ lại chủ động. Bài viết miễn phí giúp bạn học thông minh hơn.',
  th: 'ค้นพบกลยุทธ์การเรียนรู้ที่ได้รับการพิสูจน์ทางวิทยาศาสตร์ เคล็ดลับการทบทวนแบบเว้นระยะ และเทคนิคการจำแบบ Active Recall',
  id: 'Temukan strategi belajar berbasis sains, tips pengulangan berjarak, dan teknik active recall. Artikel gratis untuk membantu Anda belajar lebih cerdas.',
  es: 'Descubre estrategias de aprendizaje respaldadas por la ciencia, consejos de repetición espaciada y técnicas de recuerdo activo. Artículos gratuitos.',
}

// Use the same copy as the interactive landing page, including plans and modes.
export const LANDING_COPY = { en: landing_en, ko: landing_ko, zh: landing_zh, ja: landing_ja, vi: landing_vi, th: landing_th, id: landing_id, es: landing_es }
export const LANDING_TITLES = Object.fromEntries(UI_LOCALES.map((l) => [l, LANDING_COPY[l].seo.title]))
export const LANDING_DESCS = Object.fromEntries(UI_LOCALES.map((l) => [l, LANDING_COPY[l].seo.description]))
export const LANDING_FAQ = Object.fromEntries(UI_LOCALES.map((l) => [l,
  [1, 2, 3, 4].map((i) => ({ q: LANDING_COPY[l].faq[`q${i}`], a: LANDING_COPY[l].faq[`a${i}`] })),
]))
export const LANDING_HOWTO = Object.fromEntries(UI_LOCALES.map((l) => [l,
  [1, 2, 3].map((i) => ({ name: LANDING_COPY[l].howItWorks[`step${i}`].title, text: LANDING_COPY[l].howItWorks[`step${i}`].desc })),
]))
