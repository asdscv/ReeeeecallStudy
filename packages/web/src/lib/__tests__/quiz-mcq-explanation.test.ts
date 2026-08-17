import { describe, it, expect } from 'vitest'
import {
  validateMcqExplanation, MCQ_EXPLANATION_AXES,
} from '../../../../../supabase/functions/_shared/ai-quiz.ts'

/**
 * 객관식 해설은 **채점이 아니다**.
 *
 * 요청은 "객관식도 그냥 다 ai 채점하자" 였습니다. 정답 판정은 그대로 SQL 에 두었습니다 —
 * `option_order[choice] = correct_index`, 우리가 쓴 정답표와의 정수 비교입니다. 모델이 거기
 * 보탤 수 있는 것은 동의(무의미)·반대(결함)·유료 동의뿐입니다.
 *
 * 그래서 파는 것은 해설입니다: 정답과 고른 보기가 **무엇에서** 갈리는지(닫힌 집합의 축 하나),
 * 그리고 그것을 정리해주는 자기 카드의 그 부분(span).
 */
const input = {
  question: 'lend 의 뜻으로 옳은 것은?',
  reference: '빌려주다',
  learner: '빌리다',
  alternatives: ['갚다', '임대하다'],
  correct: false,
}

describe('객관식 해설 검증', () => {
  it('축과 span 을 받아들인다', () => {
    const out = validateMcqExplanation(
      { axis: 'direction', spans: [{ from: 'reference', start: 0, end: 3 }] }, input)
    expect(out.graded).toBe(true)
    if (!out.graded) return
    expect(out.grade.axis).toBe('direction')
    expect(out.grade.spans).toHaveLength(1)
  })

  it('모르는 축은 거절한다 — 기본값을 고르지 않는다', () => {
    // 기본값을 고르면 근거 없는 라벨이 화면에 붙습니다. 방향을 헷갈린 적이 없는 학습자가
    // "방향이 반대예요"를 돈 주고 읽게 됩니다. 거절하면 홀드가 풀리고 아무것도 청구되지 않습니다.
    for (const bad of ['confused', '', null, undefined, 42, 'DIRECTION']) {
      expect(validateMcqExplanation({ axis: bad, spans: [] }, input).graded, String(bad)).toBe(false)
    }
    expect(validateMcqExplanation(null, input).graded).toBe(false)
    expect(validateMcqExplanation({ spans: [] }, input).graded).toBe(false)
  })

  it('여덟 개 축이 모두 통과한다 — 프롬프트가 제안하는 것과 검증이 받는 것이 같아야 한다', () => {
    for (const axis of MCQ_EXPLANATION_AXES) {
      expect(validateMcqExplanation({ axis }, input).graded, axis).toBe(true)
    }
  })

  it('점수는 절대 나오지 않는다', () => {
    // 모델이 점수를 보내도 payload 에 실리지 않습니다. 실리면 `apply_quiz_explanation` 이
    // 그것을 쓸 자리를 찾게 되고, 정답표가 있는 문제를 모델이 뒤집는 길이 열립니다.
    const out = validateMcqExplanation({ axis: 'scope', score: 0, verdict: 'different' }, input)
    expect(out.graded).toBe(true)
    if (!out.graded) return
    expect(Object.keys(out.grade).sort()).toEqual(['axis', 'spans'])
  })

  it('범위를 벗어난 span 은 버리고 나머지는 살린다', () => {
    // `learner` 는 '빌리다' 로 3자입니다. 4로 끝나는 범위는 그 문자열 밖입니다.
    const out = validateMcqExplanation({
      axis: 'form',
      spans: [
        { from: 'learner', start: 0, end: 40 },
        { from: 'reference', start: 0, end: 3 },
      ],
    }, input)
    expect(out.graded).toBe(true)
    if (!out.graded) return
    expect(out.grade.spans).toEqual([{ from: 'reference', start: 0, end: 3 }])
  })

  it('span 은 세 개까지만 — 하나가 망가졌다고 뒤의 멀쩡한 것이 밀려나지 않는다', () => {
    const out = validateMcqExplanation({
      axis: 'component',
      spans: [
        'garbage', { from: 'nowhere', start: 0, end: 1 },
        { from: 'reference', start: 0, end: 1 },
        { from: 'reference', start: 1, end: 2 },
        { from: 'reference', start: 2, end: 3 },
        { from: 'reference', start: 0, end: 3 },
      ],
    }, input)
    expect(out.graded).toBe(true)
    if (!out.graded) return
    expect(out.grade.spans).toHaveLength(3)
  })
})
