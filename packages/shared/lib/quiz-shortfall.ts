/**
 * 요청한 문항 수를 못 채웠는지, 아직 만드는 중인지 가른다.
 *
 * 회차 화면은 세트가 요청 수보다 적으면 4초마다 다시 읽습니다. 배치가 뒤따라 도착하기
 * 때문인데, **영원히 못 채우는 경우**가 있습니다:
 *
 *   · 덱이 작아 카드를 다 써 버린 경우(카드 5장으로 5문항을 요청하고 한 장이 실패)
 *   · 그 카드들로는 그 유형의 문항을 만들 수 없는 경우
 *
 * 그때 지금까지는 두 가지가 동시에 일어났습니다: 조회가 4초마다 끝없이 돌고, 학습자는
 * 왜 20문항을 골랐는데 18문항인지 **아무 설명도 못 받습니다**.
 *
 * 시간으로 가릅니다. 배치 하나가 5~12초 걸리므로, 20초 동안 한 문항도 늘지 않으면 생성은
 * 끝난 것입니다. 그때 폴링을 멈추고 모자란 사실을 화면에 적습니다.
 */

/** 늘지 않은 채로 이만큼 지나면 생성이 끝난 것으로 봅니다. 4초 x 5 = 20초. */
export const QUIZ_GROWTH_IDLE_TICKS = 5
export const QUIZ_GROWTH_POLL_MS = 4000

export interface QuizGrowthState {
  /** 아직 도착할 문항이 남았다고 보고 다시 읽어야 하는가. */
  readonly polling: boolean
  /** 생성이 끝났는데 요청한 수에 못 미치는가 — 학습자에게 말해야 하는 상태. */
  readonly cameUpShort: boolean
  /** 못 받은 문항 수. `cameUpShort` 가 아닐 때는 0. */
  readonly missing: number
}

export function quizGrowth(
  itemCount: number,
  requestedCount: number | null | undefined,
  idleTicks: number,
): QuizGrowthState {
  // 요청 수를 모르면 판단하지 않습니다. 옛 회차에는 없을 수 있고, 없는 것을 근거로
  // "모자랍니다"라고 적으면 멀쩡한 퀴즈에 경고가 붙습니다.
  const target = requestedCount ?? itemCount
  const missing = Math.max(0, target - itemCount)
  if (missing === 0) return { polling: false, cameUpShort: false, missing: 0 }
  const done = idleTicks >= QUIZ_GROWTH_IDLE_TICKS
  return { polling: !done, cameUpShort: done, missing }
}
