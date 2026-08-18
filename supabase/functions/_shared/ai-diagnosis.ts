/**
 * 학습 진단 — 이미 기록해 온 라벨을 읽어, 패턴 하나와 할 일 몇 개로 돌려준다.
 *
 * ## 왜 이 파일이 산문을 돌려주지 않는가
 *
 * 이 앱의 첫 AI 기능은 모델이 `blocks[]` 를 자유 형식으로 돌려주게 했습니다. 그걸 그릴 수 있는
 * 화면은 없었고, 그래서 화면이 JSON 을 인쇄했습니다 — 학습자가 `ACTION / explain`, `SUMMARY`,
 * `CONFIDENCE` 를 읽었습니다. 미리 알 수 없는 모양에는 뷰를 쓸 수 없습니다.
 *
 * 그래서 여기서 모델은 글자를 한 자도 돌려주지 않습니다. 닫힌 집합의 라벨과 카드 id 와
 * 확신도만 돌려주고, 화면의 모든 문장은 손으로 번역된 문자열입니다. 결과가 둘 있습니다:
 *
 *   * 태국어 화면이 한국어 화면과 정확히 같은 품질입니다. 둘 다 생성되지 않았으니까요.
 *   * 모델이 **주제에 대해** 자신 있게 틀릴 수 없습니다. 貸す 가 무슨 뜻이냐고 묻지 않고,
 *     이 세 카드가 서로 닮았느냐고 묻습니다. 틀린 답은 나쁜 묶음이고, 학습자가 보고 무시할 수
 *     있습니다 — 외워버릴 거짓 사실이 아니라.
 *
 * ## 무엇을 근거로 하는가
 *
 * `get_learning_diagnosis_evidence`(mig 246)가 센 숫자들입니다. 그 라벨들은 처음부터 기록되고
 * 있었습니다: 객관식 오답마다 어떤 종류의 오답을 골랐는지, 단답 채점마다 무엇이 빠졌는지,
 * 서술형 채점마다 어느 국면이 미충족인지. 앱은 한 번도 읽어본 적이 없고, 학습자는 그동안
 * 정답률 한 줄을 '학습 진단'이라는 제목 아래에서 봤습니다.
 *
 * `packages/shared/lib/weak-themes.ts` 가 렌더링 쪽의 같은 목록을 들고 있습니다. 이 파일이
 * import 를 하지 않는 것은 엣지 런타임에 배포되는 파일이기 때문이고, 두 목록이 어긋나면
 * `quiz-feedback-labels.test.ts` 와 같은 방식의 테스트가 잡습니다.
 */

/** 카드들이 왜 서로 헷갈리는지. `weak-themes.ts` 의 목록과 같아야 한다. */
export const WEAK_THEMES = [
  'similar_meaning',
  'similar_form',
  'ambiguous_prompt',
  'multi_part',
  'long_answer',
  'no_pattern',
] as const
export type WeakTheme = typeof WEAK_THEMES[number]

/**
 * 무엇을 하라고 할 것인가.
 *
 * 전부 이 앱에서 **실제로 할 수 있는** 일입니다. 학습자가 할 수 없는 조언은 운세이고, 앱이
 * 시킬 수 없는 조언은 광고입니다.
 */
export const DIAGNOSIS_ACTIONS = [
  /** 그 카드들만 모아 다시 학습. 학습플랜의 "이 카드만 학습하기" 버튼이 하는 일. */
  'drill_cards',
  /** 한 카드가 여러 개를 묻고 있다 — 쪼개라. `multi_part` 의 자연스러운 처방. */
  'split_card',
  /** 앞면이 답을 결정하지 못한다 — 구분할 단서를 앞면에 넣어라. `ambiguous_prompt` 쪽. */
  'clarify_prompt',
  /** 고르기로는 구별이 안 붙는다 — 단답으로 풀어라. 비슷한 것끼리 헷갈릴 때. */
  'quiz_short_answer',
  /** 그 태그·덱을 집중 복습. 오답이 한 주제에 몰려 있을 때. */
  'focus_topic',
  /** 하루 분량을 줄여라. 최근 정답률이 떨어지고 있을 때. */
  'slow_down',
] as const
export type DiagnosisAction = typeof DIAGNOSIS_ACTIONS[number]

export interface DiagnosisFinding {
  readonly theme: WeakTheme
  readonly cardIds: readonly string[]
  readonly confidence: number
}

export interface DiagnosisStep {
  readonly action: DiagnosisAction
  /** 이 처방이 겨냥하는 카드들. 비어 있어도 됩니다 — `slow_down` 은 카드를 겨냥하지 않습니다. */
  readonly cardIds: readonly string[]
}

export interface Diagnosis {
  readonly findings: readonly DiagnosisFinding[]
  readonly steps: readonly DiagnosisStep[]
}

/** 이보다 낮은 확신도는 버립니다. 얼버무린 패턴은 없는 것만 못합니다. */
export const DIAGNOSIS_MIN_CONFIDENCE = 0.5
/** 이보다 적은 카드로는 '패턴'이라고 부를 것이 없습니다. */
export const DIAGNOSIS_MIN_CARDS = 2
/** 처방은 세 개까지. 여섯 개는 목록이지 처방이 아닙니다. */
export const DIAGNOSIS_MAX_STEPS = 3

/**
 * 프롬프트에 실어 보내는 카드 수와 카드당 글자 수의 상한.
 *
 * 값을 매긴 근거가 곧 이 상한입니다: 진단 1건 $0.05 는 실측 입력 1,348토큰(카드 6장) 기준
 * 원가의 98배인데, 상한이 없으면 같은 $0.05 로 카드 50장 x 2,000자를 태울 수 있었습니다.
 * 16장 x 200자면 최악이 실측의 6배 안쪽이고, 발견 하나에 최소 2장이니 여섯 가지 테마를
 * 전부 채우고도 남습니다.
 */
export const DIAGNOSIS_MAX_PROMPT_CARDS = 16
export const DIAGNOSIS_MAX_CARD_CHARS = 200

export interface DiagnosisEvidence {
  readonly scored?: number
  readonly known?: number
  readonly recent_scored?: number
  readonly recent_known?: number
  readonly mcq_flaws?: Record<string, number>
  readonly short_gaps?: Record<string, number>
  readonly short_verdicts?: Record<string, number>
  readonly essay_aspects?: Record<string, { met?: number; partial?: number; not_met?: number }>
  readonly decks?: Array<{ deck_name?: string; answers?: number; known?: number }>
  readonly tags?: Array<{ tag?: string; answers?: number; known?: number }>
}

/** 진단을 팔기에 근거가 너무 얇은 최소선. */
export const DIAGNOSIS_MIN_SCORED = 20
export const DIAGNOSIS_MIN_MISSES = 5

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

const sumCounts = (m: Record<string, number> | undefined): number =>
  m ? Object.values(m).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0) : 0

/**
 * 왜 이 진단을 팔면 안 되는지, 또는 팔아도 되면 null.
 *
 * **지갑에 손대기 전에** 부릅니다. `compareGroundingError` 와 같은 규율입니다: 근거가 없으면
 * 조용히 일반적인 답으로 물러나는 것이 아니라 거절합니다. 세 개의 데이터 위에서 찾은 패턴은
 * 패턴이 아니라 운세이고, 운세를 $1 에 파는 것은 이 파일이 존재하는 이유와 정반대입니다.
 */
export function diagnosisGroundingError(
  evidence: DiagnosisEvidence,
): 'NOT_ENOUGH_ANSWERS' | 'NOT_ENOUGH_MISSES' | null {
  const scored = typeof evidence.scored === 'number' ? evidence.scored : 0
  if (scored < DIAGNOSIS_MIN_SCORED) return 'NOT_ENOUGH_ANSWERS'
  // 라벨이 붙은 실패. 정답률만으로는 "무엇을 많이 틀리는가"에 답할 수 없고, 답할 수 없는 것을
  // 팔지 않겠다는 것이 이 검사의 전부입니다.
  const labelled = sumCounts(evidence.mcq_flaws) + sumCounts(evidence.short_gaps)
  const missed = Math.max(0, scored - (typeof evidence.known === 'number' ? evidence.known : 0))
  if (labelled < DIAGNOSIS_MIN_MISSES && missed < DIAGNOSIS_MIN_MISSES) return 'NOT_ENOUGH_MISSES'
  return null
}

const isTheme = (v: unknown): v is WeakTheme =>
  typeof v === 'string' && (WEAK_THEMES as readonly string[]).includes(v)
const isAction = (v: unknown): v is DiagnosisAction =>
  typeof v === 'string' && (DIAGNOSIS_ACTIONS as readonly string[]).includes(v)

/**
 * 모델이 돌려준 것을, 모델에게 **물어본 것**에 대고 검사한다.
 *
 * `allowedCardIds` 는 권고가 아니라 허용 목록입니다. 준 적 없는 id 를 돌려준 모델은 지어내고
 * 있거나 카드 내용에 끌려간 것이고, 어느 쪽이든 그 처방은 학습자의 실패와 무관한 카드를
 * 가리킵니다. `validateRemediationResult` 가 인용 출처에 적용하는 것과 같은 규율입니다.
 *
 * 모델 출력에 대해 절대 throw 하지 않습니다 — 나쁜 응답은 평범한 사건이고, 호출자의 대안은
 * 아무 패턴도 보여주지 않는 것입니다.
 */
export function validateDiagnosis(raw: unknown, allowedCardIds: readonly string[]): Diagnosis {
  if (!isRecord(raw)) return { findings: [], steps: [] }
  const allowed = new Set(allowedCardIds)

  const findings: DiagnosisFinding[] = []
  const claimed = new Set<string>()
  const rawFindings = Array.isArray(raw.findings) ? raw.findings : []

  // 확신도 순으로 **먼저** 정렬한 뒤 카드를 가져갑니다. 모델이 준 순서대로 가져가게 두면,
  // 앞에 놓인 얼버무린 발견이 확신 있는 발견에 필요한 카드를 가져가 버려서 그것이 두 장
  // 최소선 아래로 떨어집니다 — 약한 답이 순전히 배열 위치로 이깁니다.
  const ordered = rawFindings
    .filter(isRecord)
    .sort((a, b) => {
      const ca = typeof a.confidence === 'number' ? a.confidence : -1
      const cb = typeof b.confidence === 'number' ? b.confidence : -1
      return cb - ca
    })
    .slice(0, WEAK_THEMES.length)

  for (const entry of ordered) {
    const { theme, cardIds, confidence } = entry
    if (!isTheme(theme)) continue
    // 모델이 "패턴이 없다"고 말할 수 있어야 합니다 — 없으면 지어냅니다. 다만 그것은 화면에
    // 그릴 발견이 아니라 발견이 없다는 뜻입니다.
    if (theme === 'no_pattern') continue
    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) continue
    if (confidence < DIAGNOSIS_MIN_CONFIDENCE) continue
    if (!Array.isArray(cardIds)) continue

    const ids: string[] = []
    for (const id of cardIds) {
      if (typeof id !== 'string' || !allowed.has(id) || claimed.has(id)) continue
      ids.push(id)
    }
    if (ids.length < DIAGNOSIS_MIN_CARDS) continue
    for (const id of ids) claimed.add(id)
    findings.push({ theme, cardIds: ids, confidence })
  }

  const steps: DiagnosisStep[] = []
  const seenActions = new Set<string>()
  for (const entry of (Array.isArray(raw.steps) ? raw.steps : []).filter(isRecord)) {
    if (steps.length >= DIAGNOSIS_MAX_STEPS) break
    const { action, cardIds } = entry
    if (!isAction(action) || seenActions.has(action)) continue
    const ids = Array.isArray(cardIds)
      ? cardIds.filter((id): id is string => typeof id === 'string' && allowed.has(id))
      : []
    seenActions.add(action)
    steps.push({ action, cardIds: ids })
  }

  return { findings, steps }
}

export interface DiagnosisPromptInput {
  readonly evidence: DiagnosisEvidence
  /** 실패하고 있는 카드들. id 와 두 면만 — 덱 이름도 태그도 보내지 않습니다. */
  readonly cards: ReadonlyArray<{ id: string; prompt: string; answer: string }>
}

export function buildDiagnosisPrompt(input: DiagnosisPromptInput) {
  const themes = [
    '"similar_meaning" — the ANSWERS mean nearly the same thing, so the learner picks the wrong one.',
    '"similar_form" — the cards LOOK or sound alike (貸す/借りる, affect/effect).',
    '"ambiguous_prompt" — near-identical prompts with different answers: the prompt does not determine the answer.',
    '"multi_part" — one card asks for several things at once, so partial recall scores as failure.',
    '"long_answer" — the answer is long enough that recalling it verbatim is the difficulty, not knowing it.',
    '"no_pattern" — these cards have nothing in common. Say this rather than inventing a pattern.',
  ].map((line) => `  - ${line}`).join('\n')

  const actions = [
    '"drill_cards" — study exactly these cards again.',
    '"split_card" — the card asks for too much; split it. Pairs with multi_part.',
    '"clarify_prompt" — the front does not pin down the answer; add the distinguishing detail. Pairs with ambiguous_prompt.',
    '"quiz_short_answer" — choosing between options is not separating them; type the answer instead.',
    '"focus_topic" — one deck or tag holds most of the misses; work through it.',
    '"slow_down" — recent accuracy is falling; reduce the daily load.',
  ].map((line) => `  - ${line}`).join('\n')

  const systemPrompt = `You group a learner's failing flashcards and prescribe what to do about them. You are not a
subject expert and you are not writing an explanation.

The evidence is COUNTS this app already recorded while grading: which kinds of wrong option were chosen, which parts
of an answer were missing, which essay aspects went unmet, per-deck and per-tag accuracy, and the last 7 days against
the whole window. Read them; do not restate them.

Respond with a single JSON object:
{ "findings": [ { "theme": "similar_meaning", "cardIds": ["..."], "confidence": 0.8 } ],
  "steps": [ { "action": "drill_cards", "cardIds": ["..."] } ] }

Themes — a closed list:
${themes}

Steps — a closed list, at most ${DIAGNOSIS_MAX_STEPS}, most useful first:
${actions}

Rules:
- Every id in "cardIds" MUST come from the cards you were given. An id you were not given is discarded and the
  finding with it.
- A card belongs to at most one finding. ${DIAGNOSIS_MIN_CARDS} cards minimum, or it is not a pattern.
- "confidence" is 0..1 and yours. Below ${DIAGNOSIS_MIN_CONFIDENCE} the finding is dropped, so hedging costs you the
  finding — say "no_pattern" instead.
- Prefer a theme the EVIDENCE supports. Many adjacent_sense / right_category_wrong_item misses point at
  similar_meaning; plausible_form points at similar_form; missing_part on short answers points at multi_part.

Never write any other field. Explanations, summaries, encouragement and confidence prose are discarded — the app
renders its own sentence for every label, already translated into the learner's language. Never write a card's text
back to us; we have it.
Valid themes: ${WEAK_THEMES.map((t) => `"${t}"`).join(', ')}. Valid actions: ${DIAGNOSIS_ACTIONS.map((a) => `"${a}"`).join(', ')}.`

  // 프롬프트에는 **상한이 있어야 합니다.**
  //
  // 이 자리는 `refs.cardIds` 를 그대로 직렬화했습니다. 그 목록은 50개까지 받고 카드 한 장은
  // 2,000자까지 되므로(mig 259), 한 번의 진단이 10만 자를 모델에 밀어 넣을 수 있었습니다 —
  // 실측한 보통 요청(카드 6장, 입력 1,348토큰)의 70배가 넘고, 값은 그대로입니다. 남의 실수가
  // 아니라 그냥 긴 카드를 여러 장 고른 학습자면 도달합니다.
  //
  // 잘라도 되는 이유: 이 모델이 하는 일은 카드들이 **서로 닮았는지** 보는 것입니다. 앞 200자로
  // 안 닮아 보이는 두 카드가 뒤쪽 1,800자에서 닮아 있을 일은 없고, 있더라도 그건 학습자가
  // 헷갈리는 이유가 아닙니다. `remediation` 쪽은 이미 64KB 로 자르고 있습니다(ai-remediation.ts).
  const cards = input.cards.slice(0, DIAGNOSIS_MAX_PROMPT_CARDS).map((c) => ({
    id: c.id,
    prompt: c.prompt.slice(0, DIAGNOSIS_MAX_CARD_CHARS),
    answer: c.answer.slice(0, DIAGNOSIS_MAX_CARD_CHARS),
  }))

  const userPrompt = JSON.stringify({
    evidence: input.evidence,
    cards,
  })

  return { systemPrompt, userPrompt }
}
