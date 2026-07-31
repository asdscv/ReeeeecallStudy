// ─── Which field of a card is the PROMPT ─────────────────────────────────────
//
// A plan row has to show the learner what to recall — and must not show the answer, which
// is the one thing that makes the row worthless.
//
// The obvious `Object.values(field_values)[0]` is wrong. `field_values` is a jsonb column,
// and PostgreSQL returns jsonb object keys in its own order (shortest first, then bytewise),
// NOT insertion order. A card written as `{ front, back }` comes back as `{ back, front }`,
// so "first value" is the ANSWER. It happens to work for the app's own templates only
// because their keys are `field_1`, `field_2`, … which sort the way they were meant to be
// read; anything imported or written by hand can flip it.
//
// The card's template is the only real source of order, so that is what this consults. The
// heuristics below exist for the case where the template is not loaded — an imported deck, or
// a weak-card row whose template was not part of the plan query.

/** Field keys, in the order the template says they should be read. */
export type TemplateFieldOrder = Record<string, readonly string[]>

/**
 * Conventional prompt keys, used only when the template order is unknown.
 * Ordered by how strongly each names a question rather than an answer.
 */
const PROMPT_KEYS: readonly string[] = [
  'field_1', 'front', 'question', 'term', 'word', 'prompt', 'expression', 'kanji',
]

/** Keys that are definitely the answer; never chosen while any alternative exists. */
const ANSWER_KEYS: readonly string[] = ['back', 'answer', 'meaning', 'definition', 'translation']

const firstNonEmpty = (
  values: Record<string, string>,
  keys: readonly string[],
): string | null => {
  for (const key of keys) {
    const value = values[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

/**
 * The text to show for a card, given the template order when it is known.
 *
 * Returns an empty string when the card has no readable field at all, so the caller can fall
 * back to its own "untitled" copy rather than rendering a blank row.
 */
export function cardPromptLabel(
  fieldValues: Record<string, string> | null | undefined,
  templateId?: string | null,
  templateFields?: TemplateFieldOrder,
): string {
  if (!fieldValues) return ''

  // 1. The template's own order — the only authoritative answer.
  const ordered = templateId ? templateFields?.[templateId] : undefined
  if (ordered && ordered.length > 0) {
    const byTemplate = firstNonEmpty(fieldValues, ordered)
    if (byTemplate !== null) return byTemplate
  }

  // 2. A conventional prompt key.
  const byConvention = firstNonEmpty(fieldValues, PROMPT_KEYS)
  if (byConvention !== null) return byConvention

  // 3. Anything that is not a known answer field, in the order the row happens to arrive.
  const keys = Object.keys(fieldValues)
  const notAnswer = firstNonEmpty(fieldValues, keys.filter((k) => !ANSWER_KEYS.includes(k)))
  if (notAnswer !== null) return notAnswer

  // 4. Only the answer exists. Showing it is still better than an empty row: the learner can
  //    at least tell which card it is, and there is nothing left to spoil.
  return firstNonEmpty(fieldValues, keys) ?? ''
}
