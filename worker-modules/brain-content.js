import { scoreGuess } from '../packages/shared/lib/brain-games/games/code-break.ts'
import { BRAIN_CONTENT_GUIDES, brainContentTags, brainGuide, brainGuideForQuery, brainGuideFromTags, brainSearchPhrase } from '../packages/shared/lib/brain-content.ts'
import { buildDemo } from '../packages/shared/lib/brain-games/demo.ts'
import { brainGame } from '../packages/shared/lib/brain-games/catalog.ts'

export function brainTopic(guide, query = guide.query, locale = guide.queryLocale, format = 'guide') {
  return {
    id: `brain-${guide.id.toLowerCase()}-guide`, category: 'Brain game rules and puzzle practice',
    titleHint: query, keywords: [query], tags: brainContentTags(guide.id),
    audience: 'people looking for playable brain games and clear puzzle instructions',
    targetQuery: query, queryLocale: locale, format, brainGuide: guide.id, deckFamily: null,
  }
}

/** Product guides alternate with deck guides when there is no Search Console opportunity. */
export async function planBrainTopic(db, { allowConsecutive = false } = {}) {
  const history = await db.getPlannedArticles()
  const guideOf = (h) => brainGuideFromTags(h.tags) ?? brainGuideForQuery(h.target_query || '')
  if (!allowConsecutive && history.length > 0 && guideOf(history[0])) return null
  const covered = new Set(history.map(guideOf).filter(Boolean).map((g) => g.id))
  const next = BRAIN_CONTENT_GUIDES.find((g) => !covered.has(g.id))
  return next ? brainTopic(next) : null
}

export function brainGuideExample(id) {
  if (!brainGuide(id) || id === 'overview') return null
  const frames = buildDemo(id, { maxCols: 4, maxRows: 4 })
  const initial = frames[0].view, solved = frames.at(-1).view
  let candidateHistory
  if (id === 'codeBreak') {
    let candidates = [[]]
    for (let n = 0; n < initial.length; n++) candidates = candidates.flatMap((prefix) => initial.pool.filter((d) => initial.repeats || !prefix.includes(d)).map((d) => [...prefix, d]))
    candidateHistory = solved.guesses.map((g) => {
      candidates = candidates.filter((code) => { const r = scoreGuess(code, g.digits); return r.strikes === g.strikes && r.balls === g.balls })
      return { guess: g.digits.join(''), strikes: g.strikes, balls: g.balls, remainingCandidates: candidates.map((c) => c.join('')) }
    })
  }
  const entry = brainGame(id)
  return { ...(candidateHistory ? { candidateHistory } : {}), initial, solved, taps: frames.flatMap((f) => f.tap === undefined ? [] : [f.tap]), ...(entry.roundCap ? { puzzlesPerRound: entry.roundCap } : {}) }
}

/** Keep the code and clue arithmetic out of generated prose: the engine supplies this block. */
export function brainExampleBlock(topic, locale) {
  if (topic.brainGuide !== 'codeBreak') return null
  const example = brainGuideExample('codeBreak')
  const labels = {
    en: ['Worked example: secret code', 'Guess', 'strikes', 'balls', 'Remaining codes', 'Available digits', 'Code length'],
    ko: ['풀이 예시: 정답 코드', '추측', '스트라이크', '볼', '남은 후보', '사용하는 숫자', '코드 자리 수'],
    ja: ['例題：正解のコード', '予想', 'ストライク', 'ボール', '残りの候補', '使う数字', '桁数'],
    vi: ['Ví dụ: mã bí mật', 'Dự đoán', 'S (đúng vị trí)', 'B (sai vị trí)', 'Các mã còn lại', 'Các chữ số được dùng', 'Số chữ số'],
  }[locale] || ['Worked example: secret code', 'Guess', 'strikes', 'balls', 'Remaining codes']
  return {
    type: 'numbered_list',
    props: { items: [
      { heading: `${labels[0]} ${example.solved.secret.join('')}`, description: `${labels[5]}: ${example.initial.pool.join(', ')}. ${labels[6]}: ${example.initial.length}.` },
      ...example.candidateHistory.map((r) => ({ heading: `${labels[1]} ${r.guess}`, description: `${r.strikes} ${labels[2]} · ${r.balls} ${labels[3]}. ${labels[4]}: ${r.remainingCandidates.join(', ')}.` })),
    ] },
  }
}

export function brainPromptSection(topic, locale) {
  const guide = brainGuide(topic.brainGuide)
  if (!guide) return ''
  const example = brainGuideExample(guide.id)
  return `\n\n## Brain Game Assignment — this replaces flashcard/SRS advice
Write a practical game guide, NOT an article about health or learning outcomes.
Game: ${guide.name}. Natural search wording for this language: ${brainSearchPhrase(guide.id, locale || topic.queryLocale)}. When translating, use that wording rather than a literal translation of the original search query. Actual rule: ${guide.rule}
${example ? `Worked example from the app's real demo engine:\n${JSON.stringify(example)}\nExplain the rule accurately. Tap indices are zero-based reading-order cell/button references for interpreting the example, NOT terms to show to readers. Translate shape and colour names. Do not copy internal field names, indices or JSON into the article.` : 'Explain how to choose among the 12 available games and start a 5- or 20-minute session. Do not invent app features.'}
${guide.id === 'codeBreak' ? 'IMPORTANT: the complete worked example and its exhaustive remaining candidates are INSERTED BY CODE after generation. Do NOT write your own numeric example, guess sequence, candidate list, secret code or numeric inference in any field or block. Refer to the worked example below and explain the general rule in words. Do not use two-or-more-digit numbers in prose. Explain that a strike/ball total is a count, not an identification of which digit matches. Your article will already have a worked example, so do NOT add another mini-scenario to satisfy the generic writing instructions. Keep room for one inserted numbered_list block (at most 21 blocks in your JSON).' : 'Give a worked example using only the provided engine example, with the answer and why it is right.'}
Give the direct answer in the opening paragraph, explain the rules, name a common mistake and a way to practise. New rules start small; difficulty adapts up and down. The CTA should invite readers to play this game, not create a flashcard deck. Do not prescribe SRS for a puzzle game.
No medical, dementia, diagnosis, prevention, treatment, IQ, intelligence-score, clinically-proven, or promised improvement of memory, reasoning, focus or cognition outside the game. Game results measure performance at the game only. Never mention Quick Eye, removed games or TV programme names. Do not invent studies, expert quotes or statistics.\n`
}

export function validateBrainArticle(article, topic) {
  if (!brainGuide(topic.brainGuide)) return []
  const strings = []
  const walk = (value) => {
    if (typeof value === 'string') strings.push(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk({ title: article.title, subtitle: article.subtitle, meta_title: article.meta_title, meta_description: article.meta_description, blocks: article.content_blocks })
  const text = strings.join(' '), errors = []
  const forbidden = /치매|알츠하이머|dementia|alzheimer|認知症|sa sút trí tuệ|\bIQ\b|ADHD|clinically proven|과학적으로 (?:입증|검증)|임상적으로|기억력(?:을|이|의)?\s*(?:향상|개선)|improv(?:e|es|ing) (?:your )?memory|cải thiện trí nhớ|記憶力(?:を)?向上|빠른\s*눈|Quick Eye|더 지니어스|문제적 남자/i
  if (forbidden.test(text)) errors.push('brain guide: unsupported health claim or retired content')
  // A real rehearsal invented an inconsistent second numeric puzzle. Reject generated codes;
  // only the deterministic engine block below may supply numeric clue sequences.
  if (topic.brainGuide === 'codeBreak' && (/[0-9]{2,}/.test(text) || /[0-9]\s*(?:,|and|와|과|と|và)\s*[0-9]/i.test(text))) errors.push('Code Break: do not generate numeric examples, codes or candidate lists; the complete correct example is inserted by code. Explain the rules in words instead.')
  if (topic.brainGuide === 'codeBreak' && article.content_blocks?.length > 21) errors.push('Code Break: use at most 21 blocks to leave room for the engine example.')
  return errors
}
