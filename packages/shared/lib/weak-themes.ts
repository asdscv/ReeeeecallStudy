/**
 * Why a learner's failing cards are failing — as a closed set, never as prose.
 *
 * ## The contract, and why it is shaped like this
 *
 * The AI feature this replaces let the model return `blocks[]` of `{ type, content }`, free
 * form. Nothing could render that, so the screen printed the JSON: a learner read
 * `ACTION / explain`, `SUMMARY`, `CONFIDENCE`. The output was unrenderable BY CONSTRUCTION —
 * a view cannot be written for a shape that is not known in advance.
 *
 * So the model here returns no text at all. It returns a label from {@link WEAK_THEMES}, the
 * ids of the cards that label covers, and a confidence. Every user-facing sentence is a
 * hand-written, translated string keyed off the label. Two consequences worth stating:
 *
 *   * The Thai screen is exactly as good as the Korean one, because neither is generated.
 *     The prompt layer branches `uiLang.startsWith('ko') ? Korean : English`, so 6 of the 8
 *     locales get English instructions — every prose feature inherits that defect.
 *   * The model cannot be confidently wrong ABOUT THE SUBJECT. It is not asked what 貸す
 *     means; it is asked whether these three cards resemble each other. A wrong answer is a
 *     bad grouping, which the learner can see and dismiss, not a false fact they memorise.
 *
 * ## Why these labels and not grammar categories
 *
 * "Verb conjugation", "kanji reading", "particles" would be a Japanese-learner enum, and the
 * decks here are generic — user-made, marketplace, eight interface languages, any subject.
 * These labels describe the SHAPE of the difficulty rather than its subject matter, so they
 * hold for a pharmacology deck as well as a JLPT one, and they translate without a linguist.
 *
 * Each label also implies an action, which is the point. A theme nobody can act on is a
 * horoscope.
 */

/**
 * The whole vocabulary. Adding one means adding a translated string in 16 locale files and
 * teaching the prompt about it — deliberately more friction than letting the model invent a
 * category, because an invented category cannot be rendered or translated.
 */
export const WEAK_THEMES = [
  /** Cards whose ANSWERS mean nearly the same thing, so the learner picks the wrong one. */
  'similar_meaning',
  /** Cards that LOOK or sound alike — 貸す/借りる, affect/effect. */
  'similar_form',
  /** Near-identical prompts with different answers: the prompt does not determine the answer. */
  'ambiguous_prompt',
  /** One card asking for several things at once, so partial recall scores as failure. */
  'multi_part',
  /** An answer long enough that recalling it verbatim is the difficulty, not knowing it. */
  'long_answer',
  /** Nothing in common. The model MUST be able to say this, or it will invent a pattern. */
  'no_pattern',
] as const

export type WeakTheme = (typeof WEAK_THEMES)[number]

export interface WeakThemeFinding {
  theme: WeakTheme
  /** Cards this covers. Always a subset of what was sent; the server rejects anything else. */
  cardIds: string[]
  /** 0..1, the model's own. Used to suppress a weak guess, never shown as a number. */
  confidence: number
}

/** Below this a finding is dropped rather than shown. A hedged theme is worse than none. */
export const WEAK_THEME_MIN_CONFIDENCE = 0.5

/** Fewer cards than this cannot have a "pattern" worth naming. */
export const WEAK_THEME_MIN_CARDS = 2

export function isWeakTheme(value: unknown): value is WeakTheme {
  return typeof value === 'string' && (WEAK_THEMES as readonly string[]).includes(value)
}

/**
 * Validate what the model returned against what it was ASKED about.
 *
 * `allowedCardIds` is the allowlist and it is not advisory: a model that returns an id it was
 * never given is either hallucinating or has been steered by card content, and either way the
 * finding would point a learner at a card that has nothing to do with their failures. The same
 * discipline `validateRemediationResult` already applies to citation source ids.
 *
 * Returns the findings worth showing, or `[]`. Never throws on model output — a bad response
 * is an ordinary event, and the caller's fallback is simply to show no theme.
 */
export function validateWeakThemes(
  raw: unknown,
  allowedCardIds: readonly string[],
): WeakThemeFinding[] {
  if (!raw || typeof raw !== 'object') return []
  const themes = (raw as { themes?: unknown }).themes
  if (!Array.isArray(themes)) return []

  const allowed = new Set(allowedCardIds)
  const out: WeakThemeFinding[] = []
  // A card belongs to at most one theme. Two findings claiming the same card would render as
  // two contradictory explanations of one failure.
  const claimed = new Set<string>()

  // Sorted BEFORE claiming, not after. Claiming in the model's own order let a hedged finding
  // listed first take the cards a confident one needed, dropping the confident one below the
  // two-card minimum — the weaker answer winning purely by position in the array.
  const ordered = [...themes]
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .sort((a, b) => {
      const ca = typeof a.confidence === 'number' ? a.confidence : -1
      const cb = typeof b.confidence === 'number' ? b.confidence : -1
      return cb - ca
    })
    .slice(0, WEAK_THEMES.length)

  for (const entry of ordered) {
    const { theme, cardIds, confidence } = entry
    if (!isWeakTheme(theme)) continue
    if (theme === 'no_pattern') continue
    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) continue
    if (confidence < WEAK_THEME_MIN_CONFIDENCE) continue
    if (!Array.isArray(cardIds)) continue

    const ids: string[] = []
    for (const id of cardIds) {
      if (typeof id !== 'string' || !allowed.has(id) || claimed.has(id)) continue
      ids.push(id)
    }
    if (ids.length < WEAK_THEME_MIN_CARDS) continue

    for (const id of ids) claimed.add(id)
    out.push({ theme, cardIds: ids, confidence })
  }

  // Already strongest-first, because that is the order they claimed cards in.
  return out
}
