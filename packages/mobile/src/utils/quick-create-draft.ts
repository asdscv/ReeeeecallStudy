/**
 * In-progress "빠른 만들기" entry persistence — IO adapter.
 *
 * Mirrors `card-draft`: one draft at a time, one file, `expo-file-system` (already in
 * the native build → OTA-safe), every operation best-effort. The two screens keep
 * SEPARATE files: a card draft and a deck draft are different work, and one must never
 * be poured into the other's form.
 */
import * as FileSystem from 'expo-file-system/legacy'
import {
  isRestorableQuickCreateDraft,
  parseQuickCreateDraft,
  serializeQuickCreateDraft,
  type QuickCreateDraft,
} from './quick-create-draft-core'

// Re-exported so the screen needs one import for the whole draft surface.
export {
  hasQuickCreateContent,
  reconcileQuickCreateDraft,
  restoredDeckIsUsable,
  type QuickCreateDraft,
} from './quick-create-draft-core'

const QUICK_CREATE_DRAFT_FILE = `${FileSystem.documentDirectory}quick-create-draft-v1.json`

/** 저장해 둔 입력이 있고 아직 최근이면 돌려줍니다. 그 외에는 null. */
export async function loadQuickCreateDraft(now: number = Date.now()): Promise<QuickCreateDraft | null> {
  try {
    const info = await FileSystem.getInfoAsync(QUICK_CREATE_DRAFT_FILE)
    if (!info.exists) return null
    const draft = parseQuickCreateDraft(await FileSystem.readAsStringAsync(QUICK_CREATE_DRAFT_FILE))
    return isRestorableQuickCreateDraft(draft, now) ? draft : null
  } catch {
    return null
  }
}

/** 지금 쳐 둔 것을 적어 둡니다. 실패해도 화면은 그대로입니다. */
export async function saveQuickCreateDraft(
  d: Omit<QuickCreateDraft, 'savedAt'>,
  now: number = Date.now(),
): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(QUICK_CREATE_DRAFT_FILE, serializeQuickCreateDraft(d, now))
  } catch {
    // Non-fatal.
  }
}

/** 덱을 다 만들었거나, 사용자가 스스로 화면을 떠났을 때. */
export async function clearQuickCreateDraft(): Promise<void> {
  try {
    await FileSystem.deleteAsync(QUICK_CREATE_DRAFT_FILE, { idempotent: true })
  } catch {
    // ignore
  }
}
