// Which field of a card is the ANSWER — edge-runtime copy.
//
// SOLE server-side source of the reference answer a paid `compare` is graded against. The client
// never gets to say what the right answer is; service-role resolves it here from the template the
// card declares.
//
// Behaviour-faithful to `packages/shared/lib/card-answer.ts`; a vitest sync-guard
// (`packages/web/src/lib/__tests__/server-card-answer-parity.test.ts`) asserts the two agree on
// the same inputs. Duplicated rather than imported for the same reason `ai-prompts.ts` is:
// `supabase/functions/` is what gets deployed, and reaching into `packages/` from here makes the
// deployed bundle depend on a directory that is not part of it. Pure TS, no Deno/npm APIs, no
// imports at all → loadable by both the edge runtime and vitest.
//
// It is deliberately NOT the rendering resolver (`card-face-resolver.ts`), which falls back by
// INDEX when the template does not match. jsonb returns keys shortest-then-bytewise, so a card
// authored `{ front, back }` comes back `{ back, front }` and index 0 is the ANSWER — for the
// official word templates that guess is inverted, and it would mark a correct answer wrong.
// Absence is a usable answer here; a guess is not.

/** Structural shapes, declared locally so this file imports nothing. */
export interface AnswerLayoutItem { field_key: string }
export interface AnswerTemplateField { key: string; type: string }
export interface CardAnswerTemplate {
  fields: AnswerTemplateField[]
  front_layout: AnswerLayoutItem[]
  back_layout: AnswerLayoutItem[]
}
export interface AnswerCard { field_values: Record<string, string> }

export interface CardFaceKeys {
  /** Field keys the learner is shown — the question. */
  readonly promptKeys: readonly string[]
  /** Field keys holding what they are meant to produce — the reference answer. */
  readonly referenceKeys: readonly string[]
}

/** Layout keys that name a non-empty value on this card, in layout order, de-duplicated. */
function presentKeys(
  layout: readonly AnswerLayoutItem[] | null | undefined,
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
 * Null — never a guess — for: no template; either layout empty (`back_layout` defaults to `[]`,
 * so this is the common case); a layout naming keys the card lacks or whose values are blank; a
 * reference field that is not text (the seeded 중국어 template puts audio in `back_layout`); or
 * any field appearing on both faces, which is "the answer is the question".
 */
export function resolveCardAnswerFaces(
  template: CardAnswerTemplate | null | undefined,
  card: AnswerCard,
): CardFaceKeys | null {
  if (!template) return null
  const fieldValues = card.field_values ?? {}

  const promptKeys = presentKeys(template.front_layout, fieldValues)
  const referenceKeys = presentKeys(template.back_layout, fieldValues)
  if (promptKeys.length === 0 || referenceKeys.length === 0) return null

  // Every reference field must be text. Not "filter to the text ones": a template answering with
  // a word AND its pronunciation audio is only partly comparable, and silently dropping the half
  // we cannot handle would change what the learner is being asked to do.
  const typeByKey = new Map((template.fields ?? []).map((field) => [field.key, field.type]))
  if (!referenceKeys.every((key) => typeByKey.get(key) === 'text')) return null

  const prompt = new Set(promptKeys)
  if (referenceKeys.some((key) => prompt.has(key))) return null

  return { promptKeys, referenceKeys }
}

/** The reference answer text itself, joined in layout order, or `null` when unresolvable. */
export function cardReferenceAnswer(
  template: CardAnswerTemplate | null | undefined,
  card: AnswerCard,
): string | null {
  const faces = resolveCardAnswerFaces(template, card)
  if (!faces) return null
  const text = faces.referenceKeys.map((key) => card.field_values[key].trim()).join(' / ')
  return text === '' ? null : text
}
