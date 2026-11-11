// Official deck "families": one exam level or theme, published once per native language.
//
// An article stores a family ("toeic:800"), not a listing id, because the right listing depends
// on who is reading: a Vietnamese reader of an English TOEIC guide wants the English → Vietnamese
// deck. The family is resolved against marketplace_listings tags at render time.

export type DeckCategory = 'toeic' | 'ielts' | 'toefl' | 'conversation' | 'beginner' | 'intermediate' | 'advanced'

export interface DeckFamily {
  category: DeckCategory
  level: string
}

export const DECK_LEVELS: Readonly<Record<DeckCategory, readonly string[]>> = {
  toeic: ['600', '700', '800', '900', '990'],
  ielts: ['5.0', '5.5', '6.0', '6.5', '7.0'],
  toefl: ['60', '80', '100', '110', '120'],
  conversation: ['일상', '여행', '회사', '학습', '시사'],
  beginner: ['batch-1'],
  intermediate: ['batch-1'],
  advanced: ['batch-1'],
}

/** Native languages the official decks are published in (English is the language being learned). */
export const DECK_NATIVE_LANGUAGES = ['ko', 'ja', 'zh', 'vi', 'th', 'id', 'es'] as const

export function formatDeckFamily(f: DeckFamily): string {
  return `${f.category}:${f.level}`
}

export function parseDeckFamily(value: string | null | undefined): DeckFamily | null {
  if (!value) return null
  const at = value.indexOf(':')
  if (at < 0) return null
  const category = value.slice(0, at) as DeckCategory
  const level = value.slice(at + 1)
  return DECK_LEVELS[category]?.includes(level) ? { category, level } : null
}

/**
 * The marketplace_listings filter for this family in the reader's language, or null when no
 * official deck exists for them (English readers; conversation decks are Korean only).
 *
 * Vocabulary decks: English on the front (`source:en`), the reader's language on the back.
 * Conversation decks exist only as Korean → English, for producing English from Korean.
 */
export function deckListingFilter(family: DeckFamily, readerLanguage: string): { category: string; tags: string[] } | null {
  const lang = readerLanguage.slice(0, 2).toLowerCase()
  if (family.category === 'conversation') {
    return lang === 'ko' ? { category: 'conversation', tags: [`level:${family.level}`, 'source:ko', 'target:en'] } : null
  }
  if (!(DECK_NATIVE_LANGUAGES as readonly string[]).includes(lang)) return null
  return { category: family.category, tags: [`level:${family.level}`, 'source:en', `target:${lang}`] }
}
