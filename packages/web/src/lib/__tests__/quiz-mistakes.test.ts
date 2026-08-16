/**
 * 오답 노트 — the grouping, which decides both what the list says and what its button can do.
 *
 * Every wrong quiz answer was already recorded in `answer_attempts` and never read back. The read
 * (`get_quiz_mistakes`) hands back attempts, newest first; this turns them into the thing a screen
 * can act on. Both platforms call it, because two copies of "which card, which deck, how many
 * times" is two places for the list and the study button to start disagreeing.
 */
import { describe, it, expect } from 'vitest'
import {
  groupMistakesByDeck, mistakeResponseText, type QuizMistake,
} from '@reeeeecall/shared/stores/quiz-store'

const miss = (over: Partial<QuizMistake> & { attempt_id: string }): QuizMistake => ({
  card_id: 'card-1', deck_id: 'deck-1', deck_name: '영단어', question_type: 'mcq',
  stem: 'lend', reference_answer: '빌려주다', response: { text: '빌리다' }, score: 0,
  answered_at: '2026-08-15T00:00:00Z', ...over,
})

describe('grouping the misses', () => {
  it('buckets by deck, because a session cannot span two', () => {
    const groups = groupMistakesByDeck([
      miss({ attempt_id: 'a', card_id: 'c1', deck_id: 'd1', deck_name: '영단어' }),
      miss({ attempt_id: 'b', card_id: 'c2', deck_id: 'd2', deck_name: '중국어' }),
      miss({ attempt_id: 'c', card_id: 'c3', deck_id: 'd1', deck_name: '영단어' }),
    ])

    expect(groups.map((g) => [g.deckId, g.items.length])).toEqual([['d1', 2], ['d2', 1]])
    // The ids the study session takes, and nothing else in the bucket.
    expect(groups[0].items.map((m) => m.card_id)).toEqual(['c1', 'c3'])
  })

  it('is one row per card, keeping the most recent attempt', () => {
    // A card missed four times is one card to restudy. The input is newest-first, so the row
    // that survives is the learner's latest answer — the one worth showing them.
    const groups = groupMistakesByDeck([
      miss({ attempt_id: 'newest', card_id: 'c1', response: { text: '두 번째 시도' } }),
      miss({ attempt_id: 'older', card_id: 'c1', response: { text: '첫 번째 시도' } }),
      miss({ attempt_id: 'oldest', card_id: 'c1', response: { text: '맨 처음' } }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].items).toHaveLength(1)
    expect(groups[0].items[0].attempt_id).toBe('newest')
  })

  it('drops a miss whose card is gone', () => {
    // Nothing to restudy and no deck to open: the row's only action would be broken.
    expect(groupMistakesByDeck([
      miss({ attempt_id: 'a', card_id: null }),
      miss({ attempt_id: 'b', deck_id: null }),
    ])).toEqual([])
  })

  it('survives a deck with no name rather than dropping the cards', () => {
    const groups = groupMistakesByDeck([miss({ attempt_id: 'a', deck_name: null })])
    expect(groups[0].deckName).toBe('')
    expect(groups[0].items).toHaveLength(1)
  })

  it('is empty-safe', () => {
    expect(groupMistakesByDeck([])).toEqual([])
  })
})

describe('what the learner wrote', () => {
  it('reads a written answer', () => {
    expect(mistakeResponseText({ response: { text: '  빌리다  ' } })).toBe('빌리다')
  })

  it('says nothing for a multiple-choice pick', () => {
    // A choice INDEX is not resolved to its option text: the options were shuffled for that
    // sitting and the stored order is canonical, so an index off this row would name the wrong
    // answer more often than not.
    expect(mistakeResponseText({ response: { choice: 2 } })).toBeNull()
    expect(mistakeResponseText({ response: null })).toBeNull()
    expect(mistakeResponseText({ response: { text: '   ' } })).toBeNull()
  })
})
