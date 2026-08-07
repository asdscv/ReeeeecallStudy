// Which ONE field a quiz grades — edge-runtime copy.
//
// SOLE server-side source of the reference answer a quiz question is built from and graded
// against. The client never says what the right answer is: service-role resolves it here from
// what the template declares, then inserts it as the correct multiple-choice option and hands it
// to the grader. A model that cannot type the answer cannot mistype it.
//
// Behaviour-faithful to `packages/shared/lib/quiz-answer-field.ts`; a vitest sync-guard
// (`packages/web/src/lib/__tests__/quiz-answer-field-parity.test.ts`) asserts the two agree on
// the same inputs. Duplicated rather than imported for the same reason `card-answer.ts` and
// `ai-prompts.ts` are: `supabase/functions/` is what gets deployed, and reaching into
// `packages/` from here makes the deployed bundle depend on a directory that is not part of it.
// Pure TS, no Deno/npm APIs, no imports at all → loadable by both the edge runtime and vitest.
//
// It is deliberately NOT `./card-answer.ts`, whose reference is EVERY back-layout field joined
// with ' / '. Against the seeded 영어 단어 template that yields
// "빌려주다 / tuː lend / He lent me a book.", which as a quiz reference would mark the correct
// one-word answer wrong, leak the answer into its own distractors, make the right option
// pickable by length alone, and — because it nulls any card with a non-text back field — leave
// the seeded 중국어 template with no quizzable cards at all.

/** Structural shapes, declared locally so this file imports nothing. */
export interface QuizLayoutItem { field_key: string; style: string }
export interface QuizTemplateField { key: string; type: string; name?: string }
export interface QuizAnswerTemplate {
  fields: QuizTemplateField[]
  front_layout: QuizLayoutItem[]
  back_layout: QuizLayoutItem[]
}
export interface QuizAnswerCard { field_values: Record<string, string> }

export interface QuizCardFaces {
  /** Text fields shown as the question. At least one, or the card is unresolvable. */
  promptKeys: string[]
  /** The single field a learner's answer is graded against. */
  answerKey: string
  /** Remaining back-of-card text fields: grader context, never required of the learner. */
  contextKeys: string[]
}

interface Candidate { key: string; style: string }

/**
 * Layout entries naming a non-empty `text` value on this card, in layout order, de-duplicated.
 *
 * Non-text entries are skipped rather than fatal — the one intentional difference from
 * `card-answer.ts`, which nulls the whole card when any reference field is non-text. Correct
 * there, because its reference is the entire back. Here the reference is a single field, so an
 * audio clip sitting beside it changes nothing about what the learner must produce.
 */
function presentTextEntries(
  layout: QuizLayoutItem[] | null | undefined,
  fieldValues: Record<string, string>,
  typeByKey: Map<string, string>,
): Candidate[] {
  const out: Candidate[] = []
  const seen = new Set<string>()
  for (const item of layout ?? []) {
    if (seen.has(item.field_key)) continue
    if (typeByKey.get(item.field_key) !== 'text') continue
    const value = fieldValues[item.field_key]
    if (typeof value !== 'string' || value.trim() === '') continue
    seen.add(item.field_key)
    out.push({ key: item.field_key, style: item.style })
  }
  return out
}

/**
 * The prompt, the graded answer, and the context of a card — or `null` when it cannot be quizzed.
 *
 * Refuses rather than guesses: no template or no text front, no text back, two or more `primary`
 * fields (the author declared two answers), no `primary` with more than one candidate (layout
 * order is not a declaration), or an answer field that also appears on the front.
 *
 * A single candidate with no `primary` IS accepted — one text field on the back is the answer by
 * elimination, not a guess.
 */
export function resolveQuizCardFaces(
  template: QuizAnswerTemplate | null | undefined,
  card: QuizAnswerCard,
): QuizCardFaces | null {
  if (!template) return null
  const fieldValues = card.field_values ?? {}
  const typeByKey = new Map((template.fields ?? []).map((field) => [field.key, field.type]))

  const promptEntries = presentTextEntries(template.front_layout, fieldValues, typeByKey)
  if (promptEntries.length === 0) return null

  const candidates = presentTextEntries(template.back_layout, fieldValues, typeByKey)
  if (candidates.length === 0) return null

  const primaries = candidates.filter((c) => c.style === 'primary')
  let answerKey: string
  if (primaries.length === 1) answerKey = primaries[0].key
  else if (primaries.length === 0 && candidates.length === 1) answerKey = candidates[0].key
  else return null

  const promptKeys = promptEntries.map((entry) => entry.key)
  if (promptKeys.indexOf(answerKey) !== -1) return null

  return {
    promptKeys,
    answerKey,
    contextKeys: candidates.filter((c) => c.key !== answerKey).map((c) => c.key),
  }
}

/** The graded answer text itself, or `null` when the card cannot be quizzed. */
export function quizReferenceAnswer(
  template: QuizAnswerTemplate | null | undefined,
  card: QuizAnswerCard,
): string | null {
  const faces = resolveQuizCardFaces(template, card)
  if (!faces) return null
  const text = card.field_values[faces.answerKey].trim()
  return text === '' ? null : text
}

/** The prompt text a question is written from, joined in layout order. Never includes the answer. */
export function quizPromptText(
  template: QuizAnswerTemplate | null | undefined,
  card: QuizAnswerCard,
): string | null {
  const faces = resolveQuizCardFaces(template, card)
  if (!faces) return null
  const text = faces.promptKeys.map((key) => card.field_values[key].trim()).join(' / ')
  return text === '' ? null : text
}

/** The context lines handed to a grader, in layout order. Empty array when there are none. */
export function quizContextLines(
  template: QuizAnswerTemplate | null | undefined,
  card: QuizAnswerCard,
): string[] {
  const faces = resolveQuizCardFaces(template, card)
  if (!faces) return []
  return faces.contextKeys.map((key) => card.field_values[key].trim()).filter((v) => v !== '')
}

/**
 * The context fields with the names their template gave them.
 *
 * `quizContextLines` returns values only, which is enough for a grader but not for a question:
 * a `field_probe` built from an unnamed field asks "what is the context0 of lend?". The template
 * already names every field, so the name travels with the value.
 */
export function quizContextFields(
  template: QuizAnswerTemplate | null | undefined,
  card: QuizAnswerCard,
): Array<{ key: string; label: string; value: string }> {
  const faces = resolveQuizCardFaces(template, card)
  if (!faces || !template) return []
  const nameByKey = new Map((template.fields ?? []).map((field) => [field.key, field.name]))
  return faces.contextKeys
    .map((key) => ({ key, label: nameByKey.get(key) ?? key, value: card.field_values[key].trim() }))
    .filter((entry) => entry.value !== '')
}
