/**
 * In-progress "빠른 만들기" entry persistence — PURE core.
 *
 * Same loss as the card form (see `card-draft-core`), on the screen where the most
 * typing happens: 덱 이름 + 설명 + 카드 여러 줄. `nav-persistence` restores this route
 * after the OS reclaims a backgrounded app, so the user lands back on the same
 * 빠른 만들기 with every field blank.
 *
 * This screen carries one thing the card form does not: traces of what has ALREADY
 * been created on the server (`createdDeckId` / `createdCardCount`), which exist so a
 * retry after a partial failure never creates a second deck or duplicates cards. A
 * draft that restores the text but forgets those traces would create a duplicate deck
 * on retry; one that restores them blindly would point at a deck that may be gone.
 * 그 판단이 {@link reconcileQuickCreateDraft}(모양이 사라졌을 때)와
 * {@link restoredDeckIsUsable}(덱이 사라졌을 때)에 있습니다 — 기기 없이도 돌려볼 수 있도록
 * 화면에서 떼어 두었습니다.
 */

export interface QuickCreateDraft {
  deckName: string
  deckDescription: string
  /** 카드 모양. 필드 키(front_1…)의 의미가 여기에 달려 있습니다. */
  presetId: string
  rows: Record<string, string>[]
  /** 이미 만들어진 덱 — 재시도가 두 번째 덱을 만들지 않게 하는 값. */
  createdDeckId: string | null
  /** 이미 들어간 카드 수 — 재시도가 앞부분을 중복 삽입하지 않게 하는 값. */
  createdCardCount: number
  savedAt: number
}

/** 저장해 둔 입력을 되돌려 줄 수 있는 한도. 이유는 `card-draft-core` 와 같습니다. */
export const QUICK_CREATE_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

/** 되살릴 것이 있는지 — 공백은 입력이 아닙니다. */
export function hasQuickCreateContent(
  deckName: string,
  deckDescription: string,
  rows: Record<string, string>[],
): boolean {
  if (deckName.trim() !== '' || deckDescription.trim() !== '') return true
  return rows.some((row) =>
    Object.values(row ?? {}).some((v) => typeof v === 'string' && v.trim() !== ''))
}

export function serializeQuickCreateDraft(
  d: Omit<QuickCreateDraft, 'savedAt'>,
  now: number,
): string {
  const payload: QuickCreateDraft = { ...d, savedAt: now }
  return JSON.stringify(payload)
}

/**
 * Parse a persisted draft — never throws. Rows are sanitised cell by cell: a single
 * corrupt cell must not cost the user the rest of what they typed, and a non-string
 * would be handed straight to a TextInput `value` and crash the screen this exists
 * to rescue.
 */
export function parseQuickCreateDraft(raw: string | null | undefined): QuickCreateDraft | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const o = parsed as Record<string, unknown>
    if (typeof o.savedAt !== 'number' || !Number.isFinite(o.savedAt)) return null
    if (typeof o.presetId !== 'string' || o.presetId === '') return null
    if (!Array.isArray(o.rows)) return null
    const rows: Record<string, string>[] = []
    for (const row of o.rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue
      const cells: Record<string, string> = {}
      for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
        if (typeof v === 'string') cells[k] = v
      }
      rows.push(cells)
    }
    const count = typeof o.createdCardCount === 'number' && Number.isFinite(o.createdCardCount)
      ? Math.max(0, Math.floor(o.createdCardCount))
      : 0
    return {
      deckName: typeof o.deckName === 'string' ? o.deckName : '',
      deckDescription: typeof o.deckDescription === 'string' ? o.deckDescription : '',
      presetId: o.presetId,
      rows,
      createdDeckId: typeof o.createdDeckId === 'string' && o.createdDeckId ? o.createdDeckId : null,
      createdCardCount: count,
      savedAt: o.savedAt,
    }
  } catch {
    return null
  }
}

/** 되돌려 줄 만큼 최근인지. 미래 시각(시계 뒤틀림)과 빈 draft 는 거절합니다. */
export function isRestorableQuickCreateDraft(
  draft: QuickCreateDraft | null | undefined,
  now: number,
  maxAge: number = QUICK_CREATE_DRAFT_MAX_AGE_MS,
): boolean {
  if (!draft) return false
  if (typeof draft.savedAt !== 'number' || !Number.isFinite(draft.savedAt)) return false
  const age = now - draft.savedAt
  if (age < 0 || age > maxAge) return false
  return hasQuickCreateContent(draft.deckName, draft.deckDescription, draft.rows)
}

/**
 * 되살리기 전에 draft 를 현실과 맞춥니다.
 *
 * preset 이 더는 없으면 **행을 버립니다**. 필드 키의 뜻을 정하는 것이 preset 이라, 사라진
 * 모양으로 입력된 칸은 다른 뜻이 됩니다 (화면이 preset 을 바꿀 때 행을 비우는 것과 같은 이유).
 * 그 모양으로 만들어진 덱의 흔적도 함께 버립니다 — 이어 붙일 수 없는 덱이니까요.
 *
 * 템플릿 id 는 아예 되살리지 않습니다(저장도 하지 않습니다) — find-or-create 는 같은 모양이면
 * 같은 것을 돌려주므로, 다시 부르는 편이 죽은 id 를 검사하는 것보다 싸고 안전합니다.
 */
export function reconcileQuickCreateDraft(
  draft: QuickCreateDraft,
  opts: { presetExists: boolean },
): QuickCreateDraft {
  if (!opts.presetExists) {
    return { ...draft, rows: [], createdDeckId: null, createdCardCount: 0 }
  }
  return draft
}

/**
 * 되살린 "이미 만든 덱" 을 그대로 이어 써도 되는지 — 저장 직전에 묻습니다.
 *
 * 하루 전에 만들어 둔 덱은 그 사이 지워졌을 수 있습니다. 없는 덱에 카드를 넣으려 하면 화면에서
 * 빠져나올 수 없는 실패가 되고, 흔적을 버리면 최악이라야 이름이 같은 덱이 하나 더 생깁니다 —
 * 사용자가 지울 수 있는 실패가 지울 수 없는 실패보다 낫습니다.
 *
 * 목록 자체를 아직 모르면(빈 배열) 판단하지 않고 그대로 씁니다: "안 보인다" 와 "없다" 는
 * 다르고, 로드 전의 빈 목록을 근거로 덱을 하나 더 만들 수는 없습니다.
 */
export function restoredDeckIsUsable(deckId: string, knownDeckIds: string[]): boolean {
  if (knownDeckIds.length === 0) return true
  return knownDeckIds.includes(deckId)
}
