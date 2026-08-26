/**
 * In-progress card entry ("작성 중인 카드") persistence — PURE core.
 *
 * Why this exists: leaving the app while typing a card lost everything typed.
 * A backgrounded RN app is not guaranteed to survive — the OS reclaims it under
 * memory pressure (Android aggressively, iOS on a busy device), and the process
 * is restarted on return. `nav-persistence` already puts the user back on the
 * screen they left, which is exactly what makes the loss so visible: you come
 * back to the SAME card form with every field blank.
 *
 * The navigation state says WHERE the user was; this says WHAT they had typed.
 *
 * Split from the IO adapter (`card-draft.ts`) so the shape validation and the
 * restore rules can be unit-tested with plain tsx (no RN / expo imports here).
 */

export interface CardDraft {
  /** Which form this draft belongs to — see {@link cardDraftKey}. */
  key: string
  /** Template field key → typed value. */
  fieldValues: Record<string, string>
  /** Raw tags input, exactly as typed (comma-separated, not yet parsed). */
  tags: string
  /** Epoch ms when the draft was written. */
  savedAt: number
}

/**
 * Max age for a restorable draft. A card typed minutes or hours ago is still
 * the card the user meant to write; a draft from last week reappearing in a
 * fresh "카드 추가" form would read as a bug, not as a rescue.
 */
export const CARD_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Identity of the form a draft belongs to.
 *
 * A draft must never be poured into a DIFFERENT form: restoring deck A's
 * half-typed card into deck B, or a new-card draft into the edit form of an
 * existing card, would silently overwrite real content. Create mode has no card
 * id, so it keys on the deck alone.
 */
export function cardDraftKey(deckId: string, cardId?: string | null): string {
  return `${deckId}:${cardId ?? 'new'}`
}

/**
 * True when there is something worth keeping. Whitespace is not content —
 * persisting an untouched form would mean a stale draft outliving a form the
 * user never typed into.
 */
export function hasDraftContent(fieldValues: Record<string, string>, tags: string): boolean {
  return Object.values(fieldValues).some((v) => typeof v === 'string' && v.trim() !== '')
    || tags.trim() !== ''
}

/** Serialize a draft with its save timestamp. */
export function serializeCardDraft(
  key: string,
  fieldValues: Record<string, string>,
  tags: string,
  now: number,
): string {
  const payload: CardDraft = { key, fieldValues, tags, savedAt: now }
  return JSON.stringify(payload)
}

/**
 * Parse a persisted draft. Returns null on empty input, invalid JSON, or a shape
 * that isn't a draft — never throws. Non-string field values are dropped rather
 * than rejecting the whole draft: a single corrupt entry must not cost the user
 * the rest of what they typed (the form renders `value` into a TextInput, so a
 * non-string would crash the screen we are trying to rescue).
 */
export function parseCardDraft(raw: string | null | undefined): CardDraft | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const { key, fieldValues, tags, savedAt } = parsed as Record<string, unknown>
    if (typeof key !== 'string' || key === '') return null
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null
    if (!fieldValues || typeof fieldValues !== 'object' || Array.isArray(fieldValues)) return null
    const safeValues: Record<string, string> = {}
    for (const [k, v] of Object.entries(fieldValues as Record<string, unknown>)) {
      if (typeof v === 'string') safeValues[k] = v
    }
    return {
      key,
      fieldValues: safeValues,
      tags: typeof tags === 'string' ? tags : '',
      savedAt,
    }
  } catch {
    return null
  }
}

/**
 * True when a saved draft may be poured back into the form identified by `key`.
 * Rejects another form's draft, a stale one, a future timestamp (clock skew),
 * and an empty one (nothing to restore — and restoring it would pointlessly
 * clear a form the seed effect had already filled from the stored card).
 */
export function isRestorableDraft(
  draft: CardDraft | null | undefined,
  key: string,
  now: number,
  maxAge: number = CARD_DRAFT_MAX_AGE_MS,
): boolean {
  if (!draft || draft.key !== key) return false
  if (typeof draft.savedAt !== 'number' || !Number.isFinite(draft.savedAt)) return false
  const age = now - draft.savedAt
  if (age < 0 || age > maxAge) return false
  return hasDraftContent(draft.fieldValues, draft.tags)
}
