import type { BrainGameId } from './brain-games/types'

export type BrainGuideId = BrainGameId | 'overview'
export interface BrainContentGuide {
  id: BrainGuideId
  name: string
  query: string
  queryLocale: 'en' | 'ko'
  aliases: RegExp
  rule: string
}

/** The published games only. Stable tags identify the destination without a DB schema change. */
export const BRAIN_CONTENT_GUIDES: readonly BrainContentGuide[] = [
  { id: 'overview', name: 'Brain Training', query: '두뇌 훈련 게임 하는 법', queryLocale: 'ko', aliases: /brain\s*(training|games?)|두뇌\s*(훈련|트레이닝|게임)|뇌\s*훈련|脳トレ|trò chơi trí (nhớ|não)|rèn luyện trí não/i, rule: 'Choose a game or Today’s Training (5 or 20 minutes). Difficulty adapts to play. Levels describe performance in that game, not intelligence or health.' },
  { id: 'setMatch', name: 'Set Match', query: '합 찾기 게임 규칙', queryLocale: 'ko', aliases: /합\s*찾기|set[- ]?match|set card game/i, rule: 'Pick three cards. For EACH attribute, the three values must be all the same or all different. Two alike and one different is invalid. Colour and fill arrive later; some advanced boards offer No set.' },
  { id: 'codeBreak', name: 'Code Break', query: '숫자 야구 하는 법', queryLocale: 'ko', aliases: /숫자\s*야구|bulls?\s*(?:and|&)\s*cows?|code[- ]?break/i, rule: 'Deduce a secret code using earlier guesses. A strike means correct digit and position; a ball means correct digit in another position. Early codes have distinct digits; repeats arrive with a rule card. The foundation is one digit from two choices. Regular levels are untimed with limited guesses; extreme levels also use the selected timing setting.' },
  { id: 'makeNumber', name: 'Make the Number', query: '숫자 만들기 게임 풀이', queryLocale: 'ko', aliases: /숫자\s*만들기|make (?:the |a )?number|24[- ]?(?:game|puzzle)|24점\s*게임/i, rule: 'Use each supplied number exactly once to reach the target. Initially the numbers place themselves in a fixed order and the player chooses + or −. Later ×, ÷, ², any order, brackets and intermediate fractions arrive. Each new operator restarts with fewer numbers, then the count grows. ² squares the last number tile once; it does not use another tile. Squaring precedes multiplication and division. Multiplication and division precede addition and subtraction; brackets first.' },
  { id: 'mazeRun', name: 'Maze Run', query: '미로 찾기 게임 푸는 법', queryLocale: 'ko', aliases: /미로\s*(찾기|게임|풀이)|maze(?: run| game| puzzle| solving)|迷路/i, rule: 'Trace open corridors to the flag. Retracing erases the path. Some mazes require numbered keys in order; collected keys stay collected when backtracking. Later walls hide after a preview. Adjacent-cell tapping is an alternative to dragging.' },
  { id: 'schulte', name: 'Number Hunt', query: '숫자 순서 게임 하는 법', queryLocale: 'ko', aliases: /숫자\s*순서|number hunt|schulte\s*(?:table|grid)/i, rule: 'Tap the scattered numbers in the requested order. Later tasks include reverse order, alternating series and a preview followed by face-down cards. Follow the rule displayed on that board.' },
  { id: 'memoryGrid', name: 'Flash Grid', query: '순간 기억 게임 하는 법', queryLocale: 'ko', aliases: /순간\s*기억|flash grid|memory grid/i, rule: 'Remember the briefly lit cells, then tap those locations. Larger boards and more cells arrive as difficulty rises; some boards show the pattern in waves.' },
  { id: 'sequence', name: 'Sequence', query: '순서 기억 게임 하는 법', queryLocale: 'ko', aliases: /순서\s*기억|sequence memory (?:game|puzzle)/i, rule: 'Watch tiles light up, then repeat their order. When the reverse rule is displayed, tap in reverse. Harder tasks have more tiles and shorter flashes. Extreme sequences can revisit a cell; each flash is another step, and flash onsets remain at least 340 ms apart.' },
  { id: 'series', name: 'Number Pattern', query: '수열 규칙 찾기 풀이', queryLocale: 'ko', aliases: /(?:수열|숫자).*규칙\s*찾기|number (?:pattern|series) (?:game|puzzle)/i, rule: 'Infer a numeric rule and choose the missing or next number. Check the entire shown sequence rather than extrapolating only its last gap.' },
  { id: 'pairs', name: 'Match Pairs', query: '같은 그림 찾기 게임 하는 법', queryLocale: 'ko', aliases: /같은\s*그림\s*찾기|match pairs|memory matching game/i, rule: 'Turn over cards and find matching pictures. Remember the positions already seen. Larger boards and later three-card sets increase the challenge.' },
  { id: 'stroop', name: 'Color Word', query: '색깔 단어 게임 규칙', queryLocale: 'ko', aliases: /색깔\s*단어|colou?r word|stroop (?:game|task)/i, rule: 'Initially choose the colour of the ink, not the word’s meaning. Later follow the cue for ink or word. The app uses blue, orange, purple, black, brown and grey, rather than a red-green pair.' },
  { id: 'math', name: 'Quick Math', query: '빠른 계산 게임 하는 법', queryLocale: 'ko', aliases: /빠른\s*계산|quick math|mental arithmetic game/i, rule: 'Calculate the expression and choose the answer. Apply brackets first, then multiplication and division, then addition and subtraction.' },
  { id: 'oddOneOut', name: 'Odd One Out', query: '다른 하나 찾기 게임 하는 법', queryLocale: 'ko', aliases: /다른\s*하나\s*찾기|odd one out (?:game|puzzle)/i, rule: 'Find the single different item among similar items. Compare shapes or glyph details; later boards may include a No different item option. A lone rotated item is not a game mode.' },
]

const medicalIntent = /치매|알츠하이머|진단|치료|예방|인지\s*검사|dementia|alzheimer|diagnos|treat(?:ment)?|prevent|\biq\b|adhd|認知症|治療|予防|sa sút trí tuệ|chẩn đoán|điều trị/i
export function brainGuideForQuery(query: string): BrainContentGuide | null {
  if (medicalIntent.test(query)) return null
  // A specific game's intent wins over a generic "brain training" mention.
  return BRAIN_CONTENT_GUIDES.slice(1).find((g) => g.aliases.test(query)) ??
    (BRAIN_CONTENT_GUIDES[0].aliases.test(query) ? BRAIN_CONTENT_GUIDES[0] : null)
}
export function brainGuide(id: unknown): BrainContentGuide | null {
  return BRAIN_CONTENT_GUIDES.find((g) => g.id === id) ?? null
}
export function brainContentTags(id: BrainGuideId): string[] {
  return ['brain-training', `brain-game-${id.toLowerCase()}`]
}
export function brainGuideFromTags(tags: readonly string[] | null | undefined): BrainContentGuide | null {
  if (!Array.isArray(tags)) return null
  return BRAIN_CONTENT_GUIDES.find((g) => tags.includes(`brain-game-${g.id.toLowerCase()}`)) ??
    (tags.includes('brain-training') ? BRAIN_CONTENT_GUIDES[0] : null)
}
export function brainGuidePath(id: unknown): string | null {
  const guide = brainGuide(id)
  return guide ? guide.id === 'overview' ? '/brain' : `/brain/play/${guide.id}` : null
}
export function brainGuideLoginPath(id: unknown): string | null {
  const path = brainGuidePath(id)
  return path ? `/auth/login?redirect=${encodeURIComponent(path)}` : null
}

export function isUnsupportedBrainQuery(query: string): boolean {
  if (/빠른\s*눈|quick eye|더\s*지니어스|문제적\s*남자/i.test(query)) return true
  return medicalIntent.test(query) && /두뇌|뇌|인지|게임|퍼즐|brain|memory|puzzle|games?|脳|trí não/i.test(query)
}

/** Shared by the article UI and crawler HTML. These CTAs describe play, not health outcomes. */
const BRAIN_CTA: Record<string, { title: string; description: string; button: string }> = {
  en: { title: 'Try the rules in a real game', description: 'Start with a small puzzle. The game adjusts as you play.', button: 'Play Brain Training' },
  ko: { title: '읽은 규칙으로 직접 풀어보세요', description: '작은 문제부터 시작하고, 플레이에 따라 난이도가 달라져요.', button: '두뇌훈련 시작하기' },
  ja: { title: '実際のゲームで試しましょう', description: '小さな問題から始まり、プレイに応じて難しさが変わります。', button: '脳トレを始める' },
  vi: { title: 'Thử luật chơi trong trò chơi thật', description: 'Bắt đầu với câu đố nhỏ. Độ khó thay đổi theo cách bạn chơi.', button: 'Bắt đầu trò chơi trí não' },
  zh: { title: '在实际游戏中试一试', description: '从小谜题开始，难度随游戏表现调整。', button: '开始脑力游戏' },
  es: { title: 'Prueba las reglas en un juego real', description: 'Empieza con un puzle pequeño. La dificultad se adapta mientras juegas.', button: 'Jugar al entrenamiento mental' },
  th: { title: 'ลองใช้กติกาในเกมจริง', description: 'เริ่มจากปริศนาเล็ก ๆ ความยากจะปรับตามการเล่น', button: 'เริ่มเกมฝึกสมอง' },
  id: { title: 'Coba aturannya dalam permainan nyata', description: 'Mulai dari teka-teki kecil. Kesulitan menyesuaikan saat Anda bermain.', button: 'Mulai permainan otak' },
}
export function brainCtaCopy(locale: string): typeof BRAIN_CTA[string] {
  return BRAIN_CTA[locale.toLowerCase().split(/[-_]/)[0]] ?? BRAIN_CTA.en
}

/** Curated search wording for the existing generated locales; avoid literal "number baseball". */
const SEARCH_PHRASES: Record<BrainGuideId, { en: string; ja: string; vi: string }> = {
  overview: { en: 'brain training games for beginners', ja: '脳トレゲームの遊び方', vi: 'cách chơi trò chơi trí não' },
  setMatch: { en: 'set card game rules', ja: 'セットカードゲームのルール', vi: 'luật chơi tìm bộ ba thẻ' },
  codeBreak: { en: 'bulls and cows rules', ja: '数字当てゲームのルール', vi: 'luật chơi đoán mã số' },
  makeNumber: { en: 'make 24 game rules', ja: '数字で24を作るゲームのルール', vi: 'cách chơi tạo số 24' },
  mazeRun: { en: 'maze puzzle solving tips', ja: '迷路の解き方', vi: 'cách giải mê cung' },
  schulte: { en: 'number grid game rules', ja: '数字順番ゲームの遊び方', vi: 'cách chơi tìm số theo thứ tự' },
  memoryGrid: { en: 'memory grid game rules', ja: 'マス目記憶ゲームの遊び方', vi: 'cách chơi ghi nhớ ô sáng' },
  sequence: { en: 'sequence memory game rules', ja: '順番記憶ゲームの遊び方', vi: 'cách chơi ghi nhớ thứ tự' },
  series: { en: 'number pattern puzzles with answers', ja: '数列の規則の見つけ方', vi: 'cách tìm quy luật dãy số' },
  pairs: { en: 'memory matching game rules', ja: '絵合わせゲームの遊び方', vi: 'luật chơi tìm cặp hình giống nhau' },
  stroop: { en: 'color word game rules', ja: '色と文字のゲームのルール', vi: 'luật chơi màu sắc và từ ngữ' },
  math: { en: 'mental arithmetic game practice', ja: '暗算ゲームの遊び方', vi: 'cách luyện chơi tính nhẩm' },
  oddOneOut: { en: 'odd one out puzzle tips', ja: '仲間外れ探しゲームのコツ', vi: 'cách chơi tìm hình khác biệt' },
}
export function brainSearchPhrase(id: BrainGuideId, locale: string): string {
  const lang = locale.toLowerCase().split(/[-_]/)[0]
  return lang === 'ko' ? brainGuide(id)!.query : SEARCH_PHRASES[id][lang as 'en' | 'ja' | 'vi'] ?? SEARCH_PHRASES[id].en
}
