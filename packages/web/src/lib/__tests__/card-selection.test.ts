import { describe, it, expect } from 'vitest'
import { getPageSelectAllState, togglePageSelectAll, sanitizeSelection } from '../card-selection'

describe('card-selection', () => {
  describe('getPageSelectAllState', () => {
    it('returns "none" when page is empty', () => {
      expect(getPageSelectAllState(new Set(['a']), [])).toBe('none')
    })

    it('returns "none" when no page cards are selected', () => {
      expect(getPageSelectAllState(new Set(), ['a', 'b', 'c'])).toBe('none')
    })

    it('returns "none" when selections exist but not on this page', () => {
      expect(getPageSelectAllState(new Set(['x', 'y']), ['a', 'b', 'c'])).toBe('none')
    })

    it('returns "all" when all page cards are selected', () => {
      expect(getPageSelectAllState(new Set(['a', 'b', 'c']), ['a', 'b', 'c'])).toBe('all')
    })

    it('returns "all" even with extra selections from other pages', () => {
      expect(getPageSelectAllState(new Set(['a', 'b', 'c', 'x', 'y']), ['a', 'b', 'c'])).toBe('all')
    })

    it('returns "some" when partial page cards selected', () => {
      expect(getPageSelectAllState(new Set(['a']), ['a', 'b', 'c'])).toBe('some')
    })
  })

  describe('togglePageSelectAll', () => {
    it('selects all page cards when none selected', () => {
      const result = togglePageSelectAll(new Set(), ['a', 'b', 'c'])
      expect(result).toEqual(new Set(['a', 'b', 'c']))
    })

    it('selects remaining page cards when some selected', () => {
      const result = togglePageSelectAll(new Set(['a']), ['a', 'b', 'c'])
      expect(result).toEqual(new Set(['a', 'b', 'c']))
    })

    it('deselects all page cards when all selected', () => {
      const result = togglePageSelectAll(new Set(['a', 'b', 'c']), ['a', 'b', 'c'])
      expect(result).toEqual(new Set())
    })

    it('preserves other pages selections when selecting all', () => {
      const result = togglePageSelectAll(new Set(['x', 'y']), ['a', 'b', 'c'])
      expect(result).toEqual(new Set(['x', 'y', 'a', 'b', 'c']))
    })

    it('preserves other pages selections when deselecting all', () => {
      const result = togglePageSelectAll(new Set(['a', 'b', 'c', 'x', 'y']), ['a', 'b', 'c'])
      expect(result).toEqual(new Set(['x', 'y']))
    })

    it('returns same set for empty page', () => {
      const result = togglePageSelectAll(new Set(['x']), [])
      expect(result).toEqual(new Set(['x']))
    })

    it('does not mutate original set', () => {
      const original = new Set(['a'])
      togglePageSelectAll(original, ['a', 'b', 'c'])
      expect(original).toEqual(new Set(['a']))
    })
  })

  describe('sanitizeSelection', () => {
    it('returns same reference when all IDs are valid', () => {
      const sel = new Set(['a', 'b'])
      const valid = new Set(['a', 'b', 'c'])
      const result = sanitizeSelection(sel, valid)
      expect(result).toBe(sel) // same reference = no unnecessary re-render
    })

    it('removes stale IDs not in valid set', () => {
      const sel = new Set(['a', 'b', 'deleted1', 'deleted2'])
      const valid = new Set(['a', 'b', 'c'])
      expect(sanitizeSelection(sel, valid)).toEqual(new Set(['a', 'b']))
    })

    it('returns empty set when all IDs are stale', () => {
      const sel = new Set(['x', 'y'])
      const valid = new Set(['a', 'b'])
      expect(sanitizeSelection(sel, valid)).toEqual(new Set())
    })

    it('returns same reference for empty selection', () => {
      const sel = new Set<string>()
      const result = sanitizeSelection(sel, new Set(['a']))
      expect(result).toBe(sel)
    })

    it('does not mutate original set', () => {
      const original = new Set(['a', 'stale'])
      sanitizeSelection(original, new Set(['a']))
      expect(original).toEqual(new Set(['a', 'stale']))
    })

    // 엣지케이스: 필터 변경 시나리오
    it('scenario: filter change removes invisible cards from selection', () => {
      // 사용자가 "all" 필터에서 카드 5개 선택
      const selected = new Set(['new1', 'new2', 'review1', 'review2', 'learning1'])
      // 필터를 "new"로 변경 → filteredCards에는 new1, new2만 존재
      const visibleAfterFilter = new Set(['new1', 'new2'])
      const result = sanitizeSelection(selected, visibleAfterFilter)
      // review1, review2, learning1은 제거되어야 함
      expect(result).toEqual(new Set(['new1', 'new2']))
    })

    // 엣지케이스: 검색 변경 시나리오
    it('scenario: search narrows down and removes non-matching selections', () => {
      const selected = new Set(['apple', 'banana', 'cherry'])
      // 검색어 "app" 입력 → apple만 보임
      const visibleAfterSearch = new Set(['apple'])
      expect(sanitizeSelection(selected, visibleAfterSearch)).toEqual(new Set(['apple']))
    })

    // 엣지케이스: 단일 삭제 후 정리
    it('scenario: after single card delete, removes deleted ID', () => {
      const selected = new Set(['a', 'b', 'c'])
      // 'b'가 삭제됨 → cards에서 사라짐
      const remainingCards = new Set(['a', 'c', 'd', 'e'])
      expect(sanitizeSelection(selected, remainingCards)).toEqual(new Set(['a', 'c']))
    })
  })
})
