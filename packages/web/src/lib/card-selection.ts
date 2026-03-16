export type SelectAllState = 'all' | 'some' | 'none'

/**
 * 현재 페이지의 select-all 체크박스 상태 판별
 * - 'all': 현재 페이지 카드 전부 선택됨
 * - 'some': 일부만 선택됨 (indeterminate)
 * - 'none': 아무것도 선택 안 됨
 */
export function getPageSelectAllState(
  selectedIds: Set<string>,
  pageCardIds: string[],
): SelectAllState {
  if (pageCardIds.length === 0) return 'none'
  const selectedOnPage = pageCardIds.filter((id) => selectedIds.has(id)).length
  if (selectedOnPage === 0) return 'none'
  if (selectedOnPage === pageCardIds.length) return 'all'
  return 'some'
}

/**
 * 현재 페이지만 토글 (다른 페이지 선택은 유지)
 * - 전부 선택됨 → 현재 페이지만 해제
 * - 그 외 → 현재 페이지 전부 선택
 */
export function togglePageSelectAll(
  selectedIds: Set<string>,
  pageCardIds: string[],
): Set<string> {
  const state = getPageSelectAllState(selectedIds, pageCardIds)
  const next = new Set(selectedIds)

  if (state === 'all') {
    for (const id of pageCardIds) {
      next.delete(id)
    }
  } else {
    for (const id of pageCardIds) {
      next.add(id)
    }
  }

  return next
}

/**
 * selectedIds에서 현재 유효한 카드 ID만 남기고 stale ID 제거
 * - 필터/검색/삭제 후 존재하지 않는 ID 정리
 */
export function sanitizeSelection(
  selectedIds: Set<string>,
  validCardIds: Set<string>,
): Set<string> {
  if (selectedIds.size === 0) return selectedIds
  const next = new Set<string>()
  for (const id of selectedIds) {
    if (validCardIds.has(id)) next.add(id)
  }
  return next.size === selectedIds.size ? selectedIds : next
}
