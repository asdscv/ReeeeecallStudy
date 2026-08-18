/**
 * 카드 한 장에 담을 수 있는 글자수, 그리고 지금 몇 자인지.
 *
 * 카드는 퀴즈 생성 프롬프트에 통째로 들어가고 한 요청에 최대 열 장입니다. 그래서 카드 크기가
 * 곧 입력 토큰이고 곧 원가입니다. 상한이 필요한 이유는 그것이고, 상한을 **보여줘야** 하는
 * 이유는 따로입니다: 보이지 않는 한도는 저장을 누른 뒤에야 알게 되는 한도입니다.
 *
 * ## 왜 카드 전체인가
 *
 * 필드별 한도는 필드를 늘려 우회됩니다(500자 × 10필드). 앞면/뒷면으로 나누는 것도 답이
 * 아닙니다 — 어느 필드가 어느 면인지는 템플릿 레이아웃이 정하고, 그건 편집으로 바뀝니다.
 * 프롬프트에 들어가는 단위, 청구되는 단위, 학습자가 "카드 한 장"이라 부르는 단위가 전부
 * `field_values` 하나입니다.
 *
 * ## 왜 바이트가 아니라 글자인가
 *
 * DB 제약은 바이트입니다(`cards_field_values_size_check`). 바이트는 저장을 지키는 단위이지
 * 사람이 세는 단위가 아닙니다 — 한글은 한 글자가 3바이트라 "8,000" 이 한국어 학습자에게는
 * 2,666자이고 영어 학습자에게는 8,000자입니다. 같은 숫자가 사람마다 다른 뜻이면 그건 보여줄
 * 수 없는 숫자입니다.
 *
 * 그래서 **글자수**가 학습자가 보는 한도이고, 바이트 제약은 그 뒤에 서서 절대 먼저 걸리지
 * 않도록 넉넉히 잡습니다(4,000자 × 최악 4바이트 = 16,000).
 */

/** 카드 한 장의 모든 텍스트 필드 합계. 프로덕션 최대는 2,188자였습니다(377,099장 기준). */
export const CARD_MAX_CHARS = 4000

/** 한도에 이만큼 가까워지면 숫자를 눈에 띄게 합니다. */
const WARN_AT = 0.85

export type CardLengthState = 'ok' | 'near_limit' | 'too_long'

export interface CardLength {
  /** 지금 몇 자인가 — 모든 텍스트 필드의 합계. */
  readonly count: number
  readonly max: number
  readonly state: CardLengthState
  /** 저장할 수 있는가. 화면이 저장 버튼을 막는 데 쓰는 값. */
  readonly savable: boolean
}

/**
 * 카드의 현재 글자수.
 *
 * 이미지 필드는 데이터 URL 이라 수만 자가 되고, 그건 학습자가 "쓴 글"이 아닙니다. 세는 것은
 * 사람이 타이핑한 것뿐이므로 호출자가 텍스트 필드만 넘깁니다.
 */
export function cardLength(textValues: readonly string[]): CardLength {
  const count = textValues.reduce((sum, v) => sum + (typeof v === 'string' ? v.length : 0), 0)
  const state: CardLengthState = count > CARD_MAX_CHARS
    ? 'too_long'
    : count >= CARD_MAX_CHARS * WARN_AT ? 'near_limit' : 'ok'
  return { count, max: CARD_MAX_CHARS, state, savable: count <= CARD_MAX_CHARS }
}
