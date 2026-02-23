// Configuration constants and environment variable helpers

export const LOCALES = ['en', 'ko', 'zh', 'ja', 'es']
export const DEFAULT_LOCALE = 'en'
export const OG_LOCALE_MAP = { en: 'en_US', ko: 'ko_KR', zh: 'zh_CN', ja: 'ja_JP', es: 'es_ES' }

export const PIPELINE_DEFAULTS = {
  topicsPerRun: 10,
  maxExtraTopics: 5,
  maxBlocks: 13,
  minBlocks: 7,
  maxRetries: 3,
  recentContentLimit: 100,
  maxValidationRetries: 3,
  topicGenerationCount: 14,
}

export const RETRY_DELAYS = [1000, 3000, 8000]

// SEO content maps — per-locale titles/descriptions for bot prerendering
export const LIST_TITLES = {
  en: 'Learning Insights | ReeeeecallStudy',
  ko: '학습 인사이트 | ReeeeecallStudy',
  zh: '学习洞察 | ReeeeecallStudy',
  ja: '学習インサイト | ReeeeecallStudy',
  es: 'Perspectivas de aprendizaje | ReeeeecallStudy',
}
export const LIST_DESCS = {
  en: 'Discover science-backed learning strategies and spaced repetition tips.',
  ko: '과학적으로 검증된 학습 전략과 간격 반복 학습법을 알아보세요.',
  zh: '探索经过科学验证的学习策略和间隔重复学习技巧。',
  ja: '科学的に検証された学習戦略と間隔反復学習のコツを発見しましょう。',
  es: 'Descubre estrategias de aprendizaje respaldadas por la ciencia y consejos de repetición espaciada.',
}
export const LANDING_TITLES = {
  en: 'ReeeeecallStudy — Smart Flashcard Learning with Spaced Repetition',
  ko: 'ReeeeecallStudy — 간격 반복 학습 기반 스마트 플래시카드',
  zh: 'ReeeeecallStudy — 基于间隔重复的智能闪卡学习',
  ja: 'ReeeeecallStudy — 間隔反復学習に基づくスマートフラッシュカード',
  es: 'ReeeeecallStudy — Aprendizaje inteligente con tarjetas y repetición espaciada',
}
export const LANDING_DESCS = {
  en: 'Smart flashcard learning platform with scientifically proven spaced repetition (SRS) algorithm. Remember faster and longer.',
  ko: '과학적으로 검증된 간격 반복(SRS) 알고리즘으로 더 빠르고 오래 기억하세요.',
  zh: '采用经过科学验证的间隔重复(SRS)算法的智能闪卡学习平台。记得更快、更久。',
  ja: '科学的に実証された間隔反復(SRS)アルゴリズムを搭載したスマートフラッシュカード学習プラットフォーム。より速く、より長く記憶。',
  es: 'Plataforma de aprendizaje con tarjetas inteligentes y algoritmo de repetición espaciada (SRS) científicamente probado. Recuerda más rápido y por más tiempo.',
}

// Per-locale AI content generation instructions
export const LOCALE_INSTRUCTIONS = {
  en: 'Write the entire article in English. The slug must be in English lowercase kebab-case.',
  ko: 'Write the entire article in Korean (한국어). The slug must remain in English lowercase kebab-case. All other fields (title, subtitle, meta_title, meta_description, tags, and all content_blocks text) must be in Korean. For SEO: use Korean keywords that Korean users would search on Naver and Google Korea. meta_title and meta_description must be in Korean.',
  zh: 'Write the entire article in Simplified Chinese (简体中文). The slug must remain in English lowercase kebab-case. All other fields (title, subtitle, meta_title, meta_description, tags, and all content_blocks text) must be in Simplified Chinese. For SEO: use Chinese keywords that Chinese users would search on Baidu and Google China. meta_title and meta_description must be in Simplified Chinese.',
  ja: 'Write the entire article in Japanese (日本語). The slug must remain in English lowercase kebab-case. All other fields (title, subtitle, meta_title, meta_description, tags, and all content_blocks text) must be in Japanese. For SEO: use Japanese keywords that Japanese users would search on Google Japan and Yahoo Japan. meta_title and meta_description must be in Japanese.',
  es: 'Write the entire article in Spanish (Español). The slug must remain in English lowercase kebab-case. All other fields (title, subtitle, meta_title, meta_description, tags, and all content_blocks text) must be in Spanish. For SEO: use Spanish keywords that Spanish-speaking users would search on Google. meta_title and meta_description must be in Spanish.',
}

export function getXaiConfig(env) {
  return {
    apiKey: env.XAI_API_KEY || '',
    baseUrl: env.XAI_BASE_URL || 'https://api.x.ai/v1',
    model: env.XAI_MODEL || 'grok-3-mini',
  }
}

export function getSupabaseConfig(env) {
  return {
    url: env.SUPABASE_URL || 'https://ixdapelfikaneexnskfm.supabase.co',
    serviceKey: env.SUPABASE_SERVICE_KEY || '',
    anonKey: env.SUPABASE_ANON_KEY || '',
  }
}
