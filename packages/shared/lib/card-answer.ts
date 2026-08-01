// ─── Which field of a card is the ANSWER, when that can be known ─────────────
//
// This exists to answer one question honestly: given a card, what did its author declare to be
// the thing the learner is supposed to produce? It is the prerequisite for any feature that
// grades or compares a typed answer, because such a feature is only as honest as its reference.
//
// It is deliberately NOT `resolveCardFaceContent` (./card-face-resolver.ts). That function is
// for RENDERING and falls back by index when the template does not match — the right call when
// the job is "show the learner something", and the wrong one here. Two reasons it cannot be
// reused for grading:
//
//   1. Its fallback picks `Object.values(field_values)[1]` for the back. jsonb returns keys
//      shortest-then-bytewise, so a card authored `{ front, back }` comes back `{ back, front }`
//      — index 0 is the ANSWER. (`./card-prompt.ts` exists to document that same hazard.) For
//      the official word templates the positional guess is inverted outright.
//   2. A fallback is exactly the wrong shape for this problem. "We could not tell, so here is
//      our best guess at the answer" produces a confidently wrong comparison. Absence is a
//      usable answer; a guess is not.
//
// So: this returns `null` rather than guessing, and the caller must treat `null` as "this card
// cannot be compared", never as "use the other face".
import type { Card, CardTemplate } from '../types/database'

export interface CardFaceKeys {
  /** Field keys the learner is shown — the question. */
  readonly promptKeys: readonly string[]
  /** Field keys holding what they are meant to produce — the reference answer. */
  readonly referenceKeys: readonly string[]
}

/** Layout keys that name a non-empty value on this card, in layout order, de-duplicated. */
function presentKeys(
  layout: readonly { field_key: string }[] | null | undefined,
  fieldValues: Record<string, string>,
): string[] {
  const seen = new Set<string>()
  for (const item of layout ?? []) {
    const value = fieldValues[item.field_key]
    if (typeof value === 'string' && value.trim() !== '') seen.add(item.field_key)
  }
  return [...seen]
}

/**
 * The declared prompt and answer fields of a card, or `null` when they cannot be known.
 *
 * Resolves ONLY from what the template author declared in `front_layout` / `back_layout`. Every
 * one of these makes it `null`, and each is a case where a guess would be wrong rather than
 * merely vague:
 *
 *   - no template, or either layout empty — `back_layout` defaults to `[]`, so "no declaration"
 *     is the common case, not an exotic one;
 *   - a layout naming keys the card does not have, or whose values are blank;
 *   - a reference field that is not `type: 'text'` — you cannot compare typed words against an
 *     image or an audio clip, and the seeded 중국어 template really does put audio in
 *     `back_layout`;
 *   - prompt and reference sharing any field, which is the "the answer is the question" case.
 *
 * Note the caller still cannot grade on this alone: it says what the answer FIELD is, not that
 * a learner's paraphrase matches it.
 */
export function resolveCardAnswerFaces(
  template: CardTemplate | null | undefined,
  card: Pick<Card, 'field_values'>,
): CardFaceKeys | null {
  if (!template) return null
  const fieldValues = card.field_values ?? {}

  const promptKeys = presentKeys(template.front_layout, fieldValues)
  const referenceKeys = presentKeys(template.back_layout, fieldValues)
  if (promptKeys.length === 0 || referenceKeys.length === 0) return null

  // Every reference field must be text. Not "filter to the text ones": a template that answers
  // with a word AND its pronunciation audio is one whose answer is only partly comparable, and
  // silently dropping the half we cannot handle would change what the learner is being asked.
  const typeByKey = new Map((template.fields ?? []).map((field) => [field.key, field.type]))
  if (!referenceKeys.every((key) => typeByKey.get(key) === 'text')) return null

  // Disjoint. A shared field means the learner is being shown the thing they must produce.
  const prompt = new Set(promptKeys)
  if (referenceKeys.some((key) => prompt.has(key))) return null

  return { promptKeys, referenceKeys }
}

/** The reference answer text itself, joined in layout order, or `null` when unresolvable. */
export function cardReferenceAnswer(
  template: CardTemplate | null | undefined,
  card: Pick<Card, 'field_values'>,
): string | null {
  const faces = resolveCardAnswerFaces(template, card)
  if (!faces) return null
  const text = faces.referenceKeys.map((key) => card.field_values[key].trim()).join(' / ')
  return text === '' ? null : text
}
