// English vocabulary hubs and per-language word-list indexes.
//
// Every official deck teaches English words with meanings in one of seven native languages, so
// there is no English deck page — yet people worldwide search "toeic 800 vocabulary list" in
// English. A hub is the English page for one exam level: the shared English words with example
// sentences, and a choice of the seven decks that carry the meanings. The language indexes give
// every official deck an internal link (pages known only from a sitemap rank as unimportant).

import { DECK_NATIVE_LANGUAGES } from './official-deck-family'

export type DeckLang = (typeof DECK_NATIVE_LANGUAGES)[number]

export interface VocabHub {
  slug: string
  category: 'toeic' | 'ielts' | 'toefl'
  level: string
}

const LEVELS = {
  toeic: ['600', '700', '800', '900', '990'],
  ielts: ['5.0', '5.5', '6.0', '6.5', '7.0'],
  toefl: ['60', '80', '100', '110', '120'],
} as const

/** Only exam levels people actually search for; "beginner set 7" is not a search phrase. */
export const VOCAB_HUBS: readonly VocabHub[] = (Object.keys(LEVELS) as VocabHub['category'][]).flatMap((category) =>
  LEVELS[category].map((level) => ({
    slug: category === 'ielts' ? `ielts-band-${level.replace('.', '-')}` : `${category}-${level}`,
    category,
    level,
  })),
)

export const VOCAB_INDEX_PATH = '/vocabulary'

export function vocabHubPath(hub: VocabHub): string {
  return `${VOCAB_INDEX_PATH}/${hub.slug}`
}

export function vocabLanguageIndexPath(lang: DeckLang): string {
  return `${VOCAB_INDEX_PATH}/${lang}`
}

export function findVocabHub(slug: string): VocabHub | null {
  return VOCAB_HUBS.find((h) => h.slug === slug) ?? null
}

export function isDeckLanguage(value: string | null | undefined): value is DeckLang {
  return !!value && (DECK_NATIVE_LANGUAGES as readonly string[]).includes(value)
}

/** The hub for an «English → X» deck of this exam level; none for reverse or general decks. */
export function vocabHubForDeck(category: string, tags: string[]): VocabHub | null {
  if (!tags.includes('source:en')) return null
  const level = tags.find((t) => t.startsWith('level:'))?.slice('level:'.length)
  return VOCAB_HUBS.find((h) => h.category === category && h.level === level) ?? null
}

/** The hub for an article's deck family ('toeic:800'). */
export function vocabHubForFamily(deckFamily: string | null | undefined): VocabHub | null {
  if (!deckFamily) return null
  const [category, level] = deckFamily.split(':')
  return VOCAB_HUBS.find((h) => h.category === category && h.level === level) ?? null
}

// ─── English hub copy ────────────────────────────────────────────────────────

function examLabel(hub: VocabHub): string {
  if (hub.category === 'ielts') return `IELTS Band ${hub.level}`
  return `${hub.category.toUpperCase()} ${hub.level}`
}

const en = (n: number) => new Intl.NumberFormat('en').format(n)

export function vocabHubHeading(hub: VocabHub, wordCount: number): string {
  return `${examLabel(hub)} Vocabulary List — ${en(wordCount)} Words with Example Sentences`
}

export function vocabHubShortTitle(hub: VocabHub): string {
  return `${examLabel(hub)} Vocabulary List`
}

export function vocabHubDescription(hub: VocabHub, wordCount: number, shown: number): string {
  return `${examLabel(hub)} vocabulary: ${en(shown)} of the ${en(wordCount)} words with example sentences, picked from across the whole list. Study all of them free with spaced repetition, with meanings in your language.`
}

export function vocabHubIntro(wordCount: number, shown: number): string {
  return `${en(shown)} of the ${en(wordCount)} words, picked evenly from the whole list, each with an example sentence. To learn every word with its meaning in your language, pick your deck — they are free, and spaced repetition brings each word back right before you would forget it.`
}

export const VOCAB_HUB_CHOOSER_HEADING = 'Study all the words with meanings in your language'
export const VOCAB_HUB_COLUMNS = ['Word', 'Example sentence'] as const

/** Each language named in itself, for the deck chooser. */
export const LANGUAGE_NATIVE_NAME: Record<DeckLang, string> = {
  ko: '한국어',
  ja: '日本語',
  zh: '中文',
  vi: 'Tiếng Việt',
  th: 'ไทย',
  id: 'Bahasa Indonesia',
  es: 'Español',
}

// ─── Index pages ─────────────────────────────────────────────────────────────

export const VOCAB_EN_INDEX = {
  heading: 'Free English Vocabulary Lists — TOEIC, IELTS and TOEFL by Score',
  description: 'Free English vocabulary lists for TOEIC 600–990, IELTS band 5.0–7.0 and TOEFL 60–120, each with example sentences and flashcard decks in seven languages.',
  intro: 'Pick your exam and target score. Each list shows English words with example sentences, and links to free flashcard decks with meanings in your language.',
  languagesHeading: 'Word lists in your language',
}

interface IndexCopy {
  heading: string
  description: string
  intro: string
  categories: Record<'toeic' | 'ielts' | 'toefl' | 'beginner' | 'intermediate' | 'advanced' | 'conversation', string>
  backToIndex: string
}

export const VOCAB_LANGUAGE_INDEX: Record<DeckLang, IndexCopy> = {
  ko: {
    heading: '무료 공식 영어 단어장 — 토익·아이엘츠·토플·수준별 영단어',
    description: '토익 600~990, 아이엘츠 5.0~7.0, 토플 60~120 점수대별 영어 단어장과 초급·중급·고급 영단어, 영어 회화 표현. 단어마다 뜻과 예문을 보고 무료로 간격 반복 학습을 시작하세요.',
    intro: '단어장마다 단어 50개를 뜻·예문과 함께 보여 드립니다. 전체 단어는 무료 덱으로 간격 반복 학습할 수 있습니다.',
    categories: { toeic: '토익', ielts: '아이엘츠', toefl: '토플', beginner: '초급 영단어', intermediate: '중급 영단어', advanced: '고급 영단어', conversation: '영어 회화 표현' },
    backToIndex: '공식 단어장 전체 보기',
  },
  ja: {
    heading: '無料の公式英単語帳 — TOEIC・IELTS・TOEFL・レベル別英単語',
    description: 'TOEIC 600〜990点、IELTS 5.0〜7.0、TOEFL 60〜120点のスコア別英単語帳と、初級・中級・上級の英単語。意味と例文を確認して、無料で間隔反復学習を始めましょう。',
    intro: '各単語帳で50語を意味・例文つきで掲載しています。全単語は無料デッキで間隔反復学習できます。',
    categories: { toeic: 'TOEIC', ielts: 'IELTS', toefl: 'TOEFL', beginner: '初級英単語', intermediate: '中級英単語', advanced: '上級英単語', conversation: '英会話フレーズ' },
    backToIndex: '公式単語帳の一覧',
  },
  zh: {
    heading: '免费官方英语词汇 — 托业·雅思·托福·分级英语词汇',
    description: '托业600～990分、雅思5.0～7.0分、托福60～120分的分数段英语词汇，以及初级、中级、高级英语词汇。查看释义和例句，免费开始间隔重复学习。',
    intro: '每套词汇展示50个单词及其释义和例句。全部单词可以用免费牌组进行间隔重复学习。',
    categories: { toeic: '托业', ielts: '雅思', toefl: '托福', beginner: '初级英语词汇', intermediate: '中级英语词汇', advanced: '高级英语词汇', conversation: '英语会话表达' },
    backToIndex: '查看全部官方词汇',
  },
  vi: {
    heading: 'Bộ từ vựng tiếng Anh chính thức miễn phí — TOEIC, IELTS, TOEFL và theo trình độ',
    description: 'Từ vựng tiếng Anh theo mức điểm TOEIC 600–990, IELTS 5.0–7.0, TOEFL 60–120, cùng từ vựng sơ cấp, trung cấp và nâng cao. Xem nghĩa và ví dụ, rồi học lặp lại ngắt quãng miễn phí.',
    intro: 'Mỗi bộ hiển thị 50 từ kèm nghĩa và ví dụ. Toàn bộ từ có thể học bằng lặp lại ngắt quãng với bộ thẻ miễn phí.',
    categories: { toeic: 'TOEIC', ielts: 'IELTS', toefl: 'TOEFL', beginner: 'Từ vựng tiếng Anh sơ cấp', intermediate: 'Từ vựng tiếng Anh trung cấp', advanced: 'Từ vựng tiếng Anh nâng cao', conversation: 'Mẫu câu giao tiếp tiếng Anh' },
    backToIndex: 'Xem tất cả bộ từ vựng',
  },
  th: {
    heading: 'คลังคำศัพท์ภาษาอังกฤษทางการฟรี — TOEIC, IELTS, TOEFL และตามระดับ',
    description: 'คำศัพท์ภาษาอังกฤษตามช่วงคะแนน TOEIC 600–990, IELTS 5.0–7.0, TOEFL 60–120 และคำศัพท์ระดับต้น กลาง สูง ดูความหมายและตัวอย่าง แล้วเริ่มเรียนแบบทบทวนเว้นระยะได้ฟรี',
    intro: 'แต่ละชุดแสดง 50 คำพร้อมความหมายและตัวอย่าง คำทั้งหมดเรียนได้ด้วยการทบทวนแบบเว้นระยะผ่านชุดการ์ดฟรี',
    categories: { toeic: 'TOEIC', ielts: 'IELTS', toefl: 'TOEFL', beginner: 'คำศัพท์ภาษาอังกฤษระดับต้น', intermediate: 'คำศัพท์ภาษาอังกฤษระดับกลาง', advanced: 'คำศัพท์ภาษาอังกฤษระดับสูง', conversation: 'ประโยคสนทนาภาษาอังกฤษ' },
    backToIndex: 'ดูคลังคำศัพท์ทั้งหมด',
  },
  id: {
    heading: 'Kosakata bahasa Inggris resmi gratis — TOEIC, IELTS, TOEFL, dan per level',
    description: 'Kosakata bahasa Inggris per skor TOEIC 600–990, IELTS 5.0–7.0, TOEFL 60–120, serta kosakata dasar, menengah, dan mahir. Lihat arti dan contohnya, lalu belajar dengan pengulangan berjarak secara gratis.',
    intro: 'Setiap daftar menampilkan 50 kata beserta arti dan contohnya. Semua kata bisa dipelajari dengan pengulangan berjarak lewat dek gratis.',
    categories: { toeic: 'TOEIC', ielts: 'IELTS', toefl: 'TOEFL', beginner: 'Kosakata bahasa Inggris dasar', intermediate: 'Kosakata bahasa Inggris menengah', advanced: 'Kosakata bahasa Inggris mahir', conversation: 'Ungkapan percakapan bahasa Inggris' },
    backToIndex: 'Lihat semua kosakata',
  },
  es: {
    heading: 'Vocabulario de inglés oficial y gratuito — TOEIC, IELTS, TOEFL y por nivel',
    description: 'Vocabulario de inglés por puntuación para TOEIC 600–990, IELTS 5.0–7.0 y TOEFL 60–120, además de vocabulario básico, intermedio y avanzado. Consulta significados y ejemplos y estudia gratis con repetición espaciada.',
    intro: 'Cada lista muestra 50 palabras con su significado y ejemplos. Todas las palabras se pueden estudiar con repetición espaciada en mazos gratuitos.',
    categories: { toeic: 'TOEIC', ielts: 'IELTS', toefl: 'TOEFL', beginner: 'Vocabulario de inglés básico', intermediate: 'Vocabulario de inglés intermedio', advanced: 'Vocabulario de inglés avanzado', conversation: 'Expresiones de conversación en inglés' },
    backToIndex: 'Ver todas las listas',
  },
}

/** Display order of deck groups on a language index. */
export const VOCAB_INDEX_CATEGORY_ORDER = ['toeic', 'ielts', 'toefl', 'beginner', 'intermediate', 'advanced', 'conversation'] as const

/** hreflang for the index family: the English index (also x-default) and the seven language indexes. */
export function vocabIndexHreflang(siteUrl: string): { lang: string; href: string }[] {
  return [
    { lang: 'en', href: `${siteUrl}${VOCAB_INDEX_PATH}` },
    ...DECK_NATIVE_LANGUAGES.map((l) => ({ lang: l, href: `${siteUrl}${vocabLanguageIndexPath(l)}` })),
    { lang: 'x-default', href: `${siteUrl}${VOCAB_INDEX_PATH}` },
  ]
}

/** Sort key for decks inside a group: exam level / set number, then direction (English → X first). */
function deckSortKey(tags: string[]): [number, number] {
  const level = tags.find((t) => t.startsWith('level:'))?.slice('level:'.length) ?? ''
  const n = Number(level.replace('batch-', ''))
  return [Number.isFinite(n) ? n : 0, tags.includes('source:en') ? 0 : 1]
}

export type IndexCategory = (typeof VOCAB_INDEX_CATEGORY_ORDER)[number]

/** A language index's sections: decks grouped by category in display order, each in level order. */
export function groupDecksForIndex<T extends { category: string; tags: string[] | null }>(
  decks: readonly T[],
): { category: IndexCategory; decks: T[] }[] {
  return VOCAB_INDEX_CATEGORY_ORDER.map((category) => ({
    category,
    decks: decks.filter((d) => d.category === category).sort((a, b) => {
      const [la, da] = deckSortKey(a.tags ?? [])
      const [lb, db] = deckSortKey(b.tags ?? [])
      return la - lb || da - db
    }),
  })).filter((g) => g.decks.length > 0)
}

/** A hub's decks in language-chooser order; one per language. */
export function orderDecksByLanguage<T extends { native_language?: string | null }>(decks: readonly T[]): T[] {
  return DECK_NATIVE_LANGUAGES.map((l) => decks.find((d) => d.native_language === l)).filter((d): d is T => !!d)
}

/** The REST filter for a hub's decks: same exam level, English → X direction. */
export function vocabHubDeckTags(hub: VocabHub): string[] {
  return [`level:${hub.level}`, 'source:en']
}
