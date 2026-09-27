/**
 * Who an official deck is for, and what it teaches them.
 *
 * Every official deck is an en↔X pair shipped in both directions. The catalog was
 * built on one assumption, stated in `DeckMetadataI18n`: the audience is always the
 * non-English speaker, so a `ko → en` deck is "a Korean practising English" and its
 * title renders in Korean.
 *
 * That assumption hides a second audience. The same rows — 327 decks, 192,548 cards —
 * show Korean/Japanese/Chinese/Spanish/Vietnamese/Thai/Indonesian on the front and
 * English on the back, which is exactly what an English speaker learning that language
 * needs. They were unreachable: no listing carried `en` as a mother tongue, so an
 * English speaker filtering the marketplace got zero results.
 *
 * Nothing here creates content. It reads the direction already recorded in each
 * listing's tags and answers two questions the stored columns cannot: whose language
 * is this deck in, and what does it teach *this* viewer.
 */

export const SUPPORTED_LANGS = ['en', 'ko', 'ja', 'zh', 'es', 'vi', 'th', 'id'] as const
export type LangCode = (typeof SUPPORTED_LANGS)[number]

export interface DeckFacts {
  /** beginner | intermediate | advanced | conversation | toeic | toefl | ielts */
  readonly category: string | null
  /** `batch-3`, an exam score like `900`, or a conversation topic. Absent on a few decks. */
  readonly level: string | null
  readonly source: string | null
  readonly target: string | null
}

function tagValue(tags: readonly string[], prefix: string): string | null {
  const hit = tags.find((t) => t.startsWith(`${prefix}:`))
  return hit ? hit.slice(prefix.length + 1) : null
}

export function readDeckFacts(tags: readonly string[] | null | undefined): DeckFacts {
  const t = tags ?? []
  return {
    category: tagValue(t, 'category'),
    level: tagValue(t, 'level'),
    source: tagValue(t, 'source'),
    target: tagValue(t, 'target'),
  }
}

/** Both mother tongues an en↔X deck can serve. */
export function audienceLanguages(facts: DeckFacts): string[] {
  return [facts.source, facts.target].filter((l): l is string => !!l)
}

/**
 * What this deck teaches a viewer whose mother tongue is `viewer` — the other side of
 * the pair. Returns null when the viewer's language is not in the pair at all, because
 * then the deck is not addressed to them and guessing would mislabel it.
 */
export function taughtLanguage(facts: DeckFacts, viewer: string): string | null {
  const { source, target } = facts
  if (!source || !target) return null
  if (viewer === source) return target
  if (viewer === target) return source
  return null
}

/**
 * The language the stored `title` is written in.
 *
 * `DeckMetadataI18n` renders every deck — forward, reverse and conversation — in the
 * non-English side of its pair, so that side is what the stored title speaks.
 */
export function storedTitleLanguage(facts: DeckFacts): string | null {
  const { source, target } = facts
  if (!source || !target) return null
  return source === 'en' ? target : source
}

// ── English titles for the audience the catalog never addressed ────────────────

const LANGUAGE_NAME_EN: Record<string, string> = {
  en: 'English', ko: 'Korean', ja: 'Japanese', zh: 'Chinese',
  es: 'Spanish', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian',
}

// Conversation decks record their topic as a Korean word, since Korean was the only
// audience they were built for.
const CONVERSATION_TOPIC_EN: Record<string, string> = {
  '시사': 'Current Affairs',
  '여행': 'Travel',
  '일상': 'Everyday Life',
  '학습': 'Studying',
  '회사': 'Work',
}

const EXAM_NAME: Record<string, string> = { toeic: 'TOEIC', toefl: 'TOEFL', ielts: 'IELTS' }

const VOCAB_PREFIX_EN: Record<string, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

function batchNumber(level: string | null): string | null {
  if (!level) return null
  const m = /^batch-(\d+)$/.exec(level)
  return m ? m[1] : null
}

/**
 * A title for `viewer`, or null to keep the stored one.
 *
 * Only speaks up when the stored title is in a language the viewer does not read —
 * today that is exactly the English audience, since every stored title is written in
 * the non-English side of its pair. Everyone else already sees their own language and
 * regenerating it would risk drifting from what the import pipeline wrote.
 */
export function localizedOfficialTitle(facts: DeckFacts, viewer: string): string | null {
  if (viewer !== 'en') return null
  if (storedTitleLanguage(facts) === 'en') return null

  const taught = taughtLanguage(facts, viewer)
  const { category, level, source, target } = facts
  if (!taught || !category || !source || !target) return null

  const langName = LANGUAGE_NAME_EN[taught]
  if (!langName) return null

  const direction = ` (${LANGUAGE_NAME_EN[source] ?? source} → ${LANGUAGE_NAME_EN[target] ?? target})`

  if (category === 'conversation') {
    const topic = level ? CONVERSATION_TOPIC_EN[level] : null
    const head = topic
      ? `Real ${langName} Conversation — ${topic}`
      : `Real ${langName} Conversation`
    return head + direction
  }

  const exam = EXAM_NAME[category]
  if (exam) {
    const head = level ? `${exam} ${level} ${langName} Vocabulary` : `${exam} ${langName} Vocabulary`
    return head + direction
  }

  const prefix = VOCAB_PREFIX_EN[category]
  if (!prefix) return null
  const batch = batchNumber(level)
  const head = batch
    ? `${prefix} ${langName} Vocabulary — Batch ${batch}`
    : `${prefix} ${langName} Vocabulary`
  return head + direction
}
