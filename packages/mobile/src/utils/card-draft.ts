/**
 * In-progress card entry persistence — IO adapter.
 *
 * Same storage choice as `nav-persistence`: `expo-file-system` is already in the
 * native build (→ OTA-safe; AsyncStorage is not a dependency and adding one
 * would force a native rebuild).
 *
 * ONE draft is kept at a time, in a single file. The user is typing into one
 * form; a per-form file map would grow without bound and would need its own
 * eviction. The stored `key` says which form the draft belongs to, and
 * {@link loadCardDraft} refuses to pour it into any other one.
 *
 * All operations are best-effort: a storage failure costs at most the rescue,
 * never the screen.
 */
import * as FileSystem from 'expo-file-system/legacy'
import {
  cardDraftKey,
  hasDraftContent,
  isRestorableDraft,
  parseCardDraft,
  serializeCardDraft,
  type CardDraft,
} from './card-draft-core'

// Re-exported so a screen needs one import for the whole draft surface.
export { cardDraftKey, hasDraftContent, type CardDraft }

const CARD_DRAFT_FILE = `${FileSystem.documentDirectory}card-draft-v1.json`

/**
 * Load the draft for `key` if one is stored, fresh, and non-empty.
 * Returns null when there is nothing to restore or anything goes wrong.
 */
export async function loadCardDraft(key: string, now: number = Date.now()): Promise<CardDraft | null> {
  try {
    const info = await FileSystem.getInfoAsync(CARD_DRAFT_FILE)
    if (!info.exists) return null
    const draft = parseCardDraft(await FileSystem.readAsStringAsync(CARD_DRAFT_FILE))
    return isRestorableDraft(draft, key, now) ? draft : null
  } catch {
    return null
  }
}

/** Persist what is currently typed. Best-effort, non-blocking. */
export async function saveCardDraft(
  key: string,
  fieldValues: Record<string, string>,
  tags: string,
  now: number = Date.now(),
): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(CARD_DRAFT_FILE, serializeCardDraft(key, fieldValues, tags, now))
  } catch {
    // Non-fatal — the user keeps typing into a form that is still intact.
  }
}

/**
 * Drop the stored draft.
 *
 * Called when the card is saved and when the user leaves the screen on purpose:
 * backing out of a card form MEANS discarding it, and a draft that outlived that
 * would refill the next "카드 추가" with text the user already threw away.
 */
export async function clearCardDraft(): Promise<void> {
  try {
    await FileSystem.deleteAsync(CARD_DRAFT_FILE, { idempotent: true })
  } catch {
    // ignore
  }
}
