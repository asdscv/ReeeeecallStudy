import type { BrainGameId, RetiredGameId } from './types'

/**
 * Every rule or board change a game introduces as the level climbs — so the player is told when
 * something new appears, the first time it appears, instead of meeting it cold inside a timed trial.
 *
 * - 'rule': a new thing to DO (count down, pick the word, tap in reverse). A card stops the trial
 *   before it starts, and that trial is played unscored.
 * - 'board': the same task, bigger or faster. A short notice between trials; never blocks.
 *
 * Append-only: a mechanic's index is its bit in BrainMeta.seen — retire with `retired: true`, never
 * remove or reorder. `from` is where it first can appear, in the game's level units. Games gate new
 * rules in the round (ctx.blockRules). Copy lives in the `brain` namespace under
 * `mechanics.<copy>.title/body`.
 */
export type MechanicKind = 'rule' | 'board'

export interface MechanicInfo {
  tag: string
  /** A removed game's id (RetiredGameId) only on retired entries. */
  game: BrainGameId | RetiredGameId
  kind: MechanicKind
  from: number
  copy: string
  /** No longer produced (its content was removed). Kept so the bits after it never move. */
  retired?: true
}

export const MECHANICS: readonly MechanicInfo[] = [
  // Quick Eye — removed by the owner 2026-11-13 («빠른 눈 아예 빼자»). Kept, retired, for the bits.
  { tag: 'quickEye.periphery', game: 'quickEye', kind: 'rule', from: 2, copy: 'quickEye.periphery', retired: true },
  { tag: 'quickEye.distractors', game: 'quickEye', kind: 'rule', from: 5, copy: 'quickEye.distractors', retired: true },
  { tag: 'quickEye.similar', game: 'quickEye', kind: 'rule', from: 10, copy: 'quickEye.similar', retired: true },
  { tag: 'quickEye.sameDiff', game: 'quickEye', kind: 'rule', from: 15, copy: 'quickEye.sameDiff', retired: true },
  // Odd One Out — five levels a content tier, each growing 2×2 → 6×6 (games/odd-one-out.ts). The
  // turned-glyph puzzle is retired (owner 2026-11-13: «하나만 회전되어 있는거 찾기 빼자»).
  { tag: 'oddOneOut.rotation', game: 'oddOneOut', kind: 'rule', from: 5, copy: 'oddOneOut.rotation', retired: true },
  { tag: 'oddOneOut.lookalike', game: 'oddOneOut', kind: 'board', from: 6, copy: 'oddOneOut.lookalike' },
  { tag: 'oddOneOut.nearTwin', game: 'oddOneOut', kind: 'board', from: 10, copy: 'oddOneOut.nearTwin', retired: true },
  { tag: 'oddOneOut.glyphs', game: 'oddOneOut', kind: 'board', from: 11, copy: 'oddOneOut.glyphs' },
  { tag: 'oddOneOut.grid4', game: 'oddOneOut', kind: 'board', from: 3, copy: 'board.biggerGrid' },
  { tag: 'oddOneOut.grid5', game: 'oddOneOut', kind: 'board', from: 4, copy: 'board.biggerGrid' },
  { tag: 'oddOneOut.grid6', game: 'oddOneOut', kind: 'board', from: 5, copy: 'board.biggerGrid' },
  { tag: 'oddOneOut.grid7', game: 'oddOneOut', kind: 'board', from: 31, copy: 'board.biggerGrid' },
  // Number Hunt
  { tag: 'schulte.descending', game: 'schulte', kind: 'rule', from: 5, copy: 'schulte.descending' },
  { tag: 'schulte.reshuffle', game: 'schulte', kind: 'rule', from: 14, copy: 'schulte.reshuffle' },
  { tag: 'schulte.grid4', game: 'schulte', kind: 'board', from: 3, copy: 'board.moreNumbers' },
  { tag: 'schulte.grid5', game: 'schulte', kind: 'board', from: 6, copy: 'board.moreNumbers' },
  { tag: 'schulte.grid6', game: 'schulte', kind: 'board', from: 18, copy: 'board.moreNumbers' },
  // Flash Grid — board size by area, portrait and landscape alike: 16, 24, 30, 35 cells (§3.6).
  // Waves and fastShow `from`: where a 5×7 phone first meets them (a 7×7 desktop: L19, L20).
  { tag: 'memoryGrid.grid4', game: 'memoryGrid', kind: 'board', from: 2, copy: 'board.biggerGrid' },
  { tag: 'memoryGrid.grid5', game: 'memoryGrid', kind: 'board', from: 5, copy: 'board.biggerGrid' },
  { tag: 'memoryGrid.grid6', game: 'memoryGrid', kind: 'board', from: 8, copy: 'board.biggerGrid' },
  { tag: 'memoryGrid.grid7', game: 'memoryGrid', kind: 'board', from: 11, copy: 'board.biggerGrid' },
  { tag: 'memoryGrid.fastShow', game: 'memoryGrid', kind: 'board', from: 17, copy: 'memoryGrid.fastShow' },
  // Sequence
  { tag: 'sequence.reverse', game: 'sequence', kind: 'rule', from: 4, copy: 'sequence.reverse' },
  { tag: 'sequence.grid4', game: 'sequence', kind: 'board', from: 5, copy: 'board.biggerGrid' },
  // Number Pattern — told, never shown worked out: an example would answer a reasoning puzzle.
  { tag: 'series.descending', game: 'series', kind: 'board', from: 3, copy: 'series.descending' },
  { tag: 'series.geometric', game: 'series', kind: 'board', from: 4, copy: 'series.geometric' },
  { tag: 'series.alternating', game: 'series', kind: 'board', from: 5, copy: 'series.alternating' },
  { tag: 'series.growing', game: 'series', kind: 'board', from: 6, copy: 'series.growing' },
  { tag: 'series.fibonacci', game: 'series', kind: 'board', from: 9, copy: 'series.fibonacci' },
  { tag: 'series.squares', game: 'series', kind: 'board', from: 20, copy: 'series.squares' },
  { tag: 'series.interleaved', game: 'series', kind: 'board', from: 8, copy: 'series.interleaved' },
  { tag: 'series.doublePlus', game: 'series', kind: 'board', from: 10, copy: 'series.doublePlus' },
  // Match Pairs
  { tag: 'pairs.oneFamily', game: 'pairs', kind: 'board', from: 5, copy: 'pairs.oneFamily' },
  { tag: 'pairs.noPreview', game: 'pairs', kind: 'rule', from: 3, copy: 'pairs.noPreview' },
  { tag: 'pairs.board4', game: 'pairs', kind: 'board', from: 2, copy: 'board.moreCards' },
  { tag: 'pairs.board6', game: 'pairs', kind: 'board', from: 4, copy: 'board.moreCards' },
  { tag: 'pairs.board8', game: 'pairs', kind: 'board', from: 6, copy: 'board.moreCards' },
  { tag: 'pairs.board10', game: 'pairs', kind: 'board', from: 9, copy: 'board.moreCards' },
  { tag: 'pairs.board12', game: 'pairs', kind: 'board', from: 11, copy: 'board.moreCards' },
  // Color Word
  { tag: 'stroop.word', game: 'stroop', kind: 'rule', from: 10, copy: 'stroop.word' },
  { tag: 'stroop.options3', game: 'stroop', kind: 'board', from: 2, copy: 'board.moreChoices' },
  { tag: 'stroop.options4', game: 'stroop', kind: 'board', from: 4, copy: 'board.moreChoices' },
  { tag: 'stroop.options5', game: 'stroop', kind: 'board', from: 6, copy: 'board.moreChoices' },
  { tag: 'stroop.options6', game: 'stroop', kind: 'board', from: 7, copy: 'board.moreChoices' },
  // Quick Math — tags are read off the problem shown (games/math-bands.ts problemTags). twoStep is
  // every order-of-operations problem (× ÷ before + −), from band 13.
  { tag: 'math.sub', game: 'math', kind: 'board', from: 3, copy: 'math.sub' },
  { tag: 'math.mul', game: 'math', kind: 'board', from: 4, copy: 'math.mul' },
  { tag: 'math.div', game: 'math', kind: 'board', from: 6, copy: 'math.div' },
  { tag: 'math.twoStep', game: 'math', kind: 'rule', from: 13, copy: 'math.twoStep' },
  // Quick Eye's redesigned field — retired with the game (2026-11-13).
  { tag: 'quickEye.clearView', game: 'quickEye', kind: 'board', from: 1, copy: 'quickEye.clearView', retired: true },
  // ── Bits 49+: the hard-content block (GAMES_DIFFICULTY_PLAN §2.10). Each game's block sits
  // apart, so edits to one game never touch another game's lines.
  // Quick Math — harder content (GAMES_DIFFICULTY_PLAN §3.1).
  { tag: 'math.missing', game: 'math', kind: 'rule', from: 11, copy: 'math.missing' },
  { tag: 'math.threeDigit', game: 'math', kind: 'board', from: 14, copy: 'math.threeDigit' },
  { tag: 'math.parens', game: 'math', kind: 'board', from: 20, copy: 'math.parens' },
  { tag: 'math.bigMul', game: 'math', kind: 'board', from: 22, copy: 'math.bigMul' },
  // Number Pattern — harder families (§3.2).
  { tag: 'series.halving', game: 'series', kind: 'board', from: 7, copy: 'series.halving' },
  { tag: 'series.altOps', game: 'series', kind: 'board', from: 11, copy: 'series.altOps' },
  { tag: 'series.mixedLines', game: 'series', kind: 'board', from: 12, copy: 'series.mixedLines' },
  { tag: 'series.growFactor', game: 'series', kind: 'board', from: 13, copy: 'series.growFactor' },
  { tag: 'series.tribonacci', game: 'series', kind: 'board', from: 14, copy: 'series.tribonacci' },
  { tag: 'series.threeLines', game: 'series', kind: 'board', from: 15, copy: 'series.threeLines' },
  { tag: 'series.diffGrowing', game: 'series', kind: 'board', from: 16, copy: 'series.diffGrowing' },
  { tag: 'series.opCycle', game: 'series', kind: 'board', from: 17, copy: 'series.opCycle' },
  { tag: 'series.diffLines', game: 'series', kind: 'board', from: 18, copy: 'series.diffLines' },
  { tag: 'series.diffFib', game: 'series', kind: 'board', from: 19, copy: 'series.diffFib' },
  { tag: 'series.cubes', game: 'series', kind: 'board', from: 20, copy: 'series.cubes' },
  { tag: 'series.missingTerm', game: 'series', kind: 'rule', from: 21, copy: 'series.missingTerm' },
  // Odd One Out — mirror (tier 4), colour noise and glyph twins (tier 5), «없음» (tier 6).
  { tag: 'oddOneOut.colorNoise', game: 'oddOneOut', kind: 'board', from: 21, copy: 'oddOneOut.colorNoise' },
  { tag: 'oddOneOut.mirror', game: 'oddOneOut', kind: 'rule', from: 16, copy: 'oddOneOut.mirror' },
  { tag: 'oddOneOut.absent', game: 'oddOneOut', kind: 'rule', from: 26, copy: 'oddOneOut.absent' },
  { tag: 'oddOneOut.glyphTwin', game: 'oddOneOut', kind: 'board', from: 21, copy: 'oddOneOut.glyphTwin' },
  // Number Hunt — two-digit runs, skip counting, alternation, no marks (§3.4).
  { tag: 'schulte.twoDigit', game: 'schulte', kind: 'board', from: 8, copy: 'schulte.twoDigit' },
  { tag: 'schulte.skipCount', game: 'schulte', kind: 'board', from: 9, copy: 'schulte.skipCount' },
  { tag: 'schulte.alternate', game: 'schulte', kind: 'rule', from: 10, copy: 'schulte.alternate' },
  { tag: 'schulte.alternateOpposite', game: 'schulte', kind: 'rule', from: 12, copy: 'schulte.alternateOpposite' },
  { tag: 'schulte.unmarked', game: 'schulte', kind: 'board', from: 16, copy: 'schulte.unmarked' },
  // Color Word — moving buttons, coloured labels, frequent switches, frame (§3.5).
  { tag: 'stroop.shuffle', game: 'stroop', kind: 'board', from: 5, copy: 'stroop.shuffle' },
  { tag: 'stroop.labelInk', game: 'stroop', kind: 'rule', from: 8, copy: 'stroop.labelInk' },
  { tag: 'stroop.switchOften', game: 'stroop', kind: 'board', from: 12, copy: 'stroop.switchOften' },
  { tag: 'stroop.frame', game: 'stroop', kind: 'board', from: 14, copy: 'stroop.frame' },
  // Flash Grid — shown in waves (§3.6).
  { tag: 'memoryGrid.waves', game: 'memoryGrid', kind: 'board', from: 16, copy: 'memoryGrid.waves' },
  // Match Pairs — look-alike pictures, triples (§3.8).
  { tag: 'pairs.lookalike', game: 'pairs', kind: 'board', from: 8, copy: 'pairs.lookalike' },
  { tag: 'pairs.triples', game: 'pairs', kind: 'rule', from: 14, copy: 'pairs.triples' },
  // ── Higher ceilings (owner 2026-11-13: more tiles, faster flashes, more cells, more cards).
  // Sequence — 5×5 board from L8, flashes faster than one a second from L6 (never over 3/s).
  { tag: 'sequence.grid5', game: 'sequence', kind: 'board', from: 8, copy: 'board.biggerGrid' },
  { tag: 'sequence.faster', game: 'sequence', kind: 'board', from: 6, copy: 'sequence.faster' },
  // Flash Grid — 7×6 (42 cells) and 7×7 (49) boards on screens that hold them.
  { tag: 'memoryGrid.grid7x6', game: 'memoryGrid', kind: 'board', from: 13, copy: 'board.biggerGrid' },
  { tag: 'memoryGrid.grid7x7', game: 'memoryGrid', kind: 'board', from: 15, copy: 'board.biggerGrid' },
  // Match Pairs — 30, 36 and 42 cards.
  { tag: 'pairs.board15', game: 'pairs', kind: 'board', from: 17, copy: 'board.moreCards' },
  { tag: 'pairs.board18', game: 'pairs', kind: 'board', from: 22, copy: 'board.moreCards' },
  { tag: 'pairs.board21', game: 'pairs', kind: 'board', from: 25, copy: 'board.moreCards' },
  // ── The thinking games (owner 2026-11-13), one block a game. A new kind of content is a rule (a
  // card, played unscored) and starts small again; more of the same is a board notice.
  // Set Match — colour, then fill, join shape and count, each from four cards; one-set boards; «없음»
  // from nine cards again; 15 cards (games/set-match.ts).
  { tag: 'setMatch.board6', game: 'setMatch', kind: 'board', from: 2, copy: 'board.moreCards' },
  // Two attributes make only 9 cards (a 9-card board is every one), so nine cards first come with colour.
  { tag: 'setMatch.board9', game: 'setMatch', kind: 'board', from: 6, copy: 'board.moreCards' },
  { tag: 'setMatch.color', game: 'setMatch', kind: 'rule', from: 4, copy: 'setMatch.color' },
  { tag: 'setMatch.board12', game: 'setMatch', kind: 'board', from: 7, copy: 'board.moreCards' },
  { tag: 'setMatch.fill', game: 'setMatch', kind: 'rule', from: 8, copy: 'setMatch.fill' },
  { tag: 'setMatch.oneSet', game: 'setMatch', kind: 'board', from: 13, copy: 'setMatch.oneSet' },
  { tag: 'setMatch.none', game: 'setMatch', kind: 'rule', from: 16, copy: 'setMatch.none' },
  { tag: 'setMatch.board15', game: 'setMatch', kind: 'board', from: 18, copy: 'board.moreCards' },
  // Code Break — three, four, five digits; 0 in the pool; repeating digits.
  { tag: 'codeBreak.three', game: 'codeBreak', kind: 'board', from: 4, copy: 'codeBreak.three' },
  { tag: 'codeBreak.four', game: 'codeBreak', kind: 'board', from: 8, copy: 'codeBreak.four' },
  { tag: 'codeBreak.zero', game: 'codeBreak', kind: 'board', from: 12, copy: 'codeBreak.zero' },
  { tag: 'codeBreak.repeats', game: 'codeBreak', kind: 'rule', from: 13, copy: 'codeBreak.repeats' },
  { tag: 'codeBreak.five', game: 'codeBreak', kind: 'board', from: 19, copy: 'codeBreak.five' },
  // Make the Number (games/make-number.ts) — numbers in a fixed order (signs only) with + −, then ×
  // (L4) and ÷ (L7); any order (L10, appended below); brackets (L13); 24 (L16); a fraction on the way
  // (L17). Each rule from three numbers again. The first line was `tiles3`, renamed in place
  // (unreleased): L1 already has three numbers.
  { tag: 'makeNumber.target24', game: 'makeNumber', kind: 'board', from: 16, copy: 'makeNumber.target24' },
  { tag: 'makeNumber.tiles4', game: 'makeNumber', kind: 'board', from: 2, copy: 'board.moreNumbers' },
  { tag: 'makeNumber.multiply', game: 'makeNumber', kind: 'rule', from: 4, copy: 'makeNumber.multiply' },
  { tag: 'makeNumber.divide', game: 'makeNumber', kind: 'rule', from: 7, copy: 'makeNumber.divide' },
  { tag: 'makeNumber.brackets', game: 'makeNumber', kind: 'rule', from: 13, copy: 'makeNumber.brackets' },
  { tag: 'makeNumber.tiles5', game: 'makeNumber', kind: 'board', from: 3, copy: 'board.moreNumbers' },
  { tag: 'makeNumber.fraction', game: 'makeNumber', kind: 'rule', from: 17, copy: 'makeNumber.fraction' },
  // Maze Run (games/maze-run.ts) — open mazes 4×4 → 8×8; winding (L6, its own notice below);
  // keys in order (L11, a rule, from 4×4 again); hidden walls (L16, a rule, from 4×4 again); keys
  // inside hidden mazes (L21, from 4×4 again). Size notices go by the band's own size (6×6, 8×8).
  { tag: 'mazeRun.grid6', game: 'mazeRun', kind: 'board', from: 3, copy: 'board.biggerGrid' },
  { tag: 'mazeRun.grid8', game: 'mazeRun', kind: 'board', from: 5, copy: 'board.biggerGrid' },
  { tag: 'mazeRun.keys', game: 'mazeRun', kind: 'rule', from: 11, copy: 'mazeRun.keys' },
  { tag: 'mazeRun.twoKeys', game: 'mazeRun', kind: 'board', from: 13, copy: 'mazeRun.moreKeys' },
  { tag: 'mazeRun.hidden', game: 'mazeRun', kind: 'rule', from: 16, copy: 'mazeRun.hidden' },
  { tag: 'mazeRun.threeKeys', game: 'mazeRun', kind: 'board', from: 15, copy: 'mazeRun.moreKeys' },
  // Keys inside a hidden maze — two rules already met, together for the first time (a smaller maze).
  { tag: 'mazeRun.hiddenKeys', game: 'mazeRun', kind: 'board', from: 21, copy: 'mazeRun.hiddenKeys' },
  // Number Pattern — more rule families (owner 2026-11-13 «더 다양한 규칙»), each from the band
  // that brings it (games/series-rules.ts): primes, the two before multiplied, digit sums, prime gaps.
  { tag: 'series.primes', game: 'series', kind: 'board', from: 12, copy: 'series.primes' },
  { tag: 'series.product', game: 'series', kind: 'board', from: 14, copy: 'series.product' },
  { tag: 'series.digitSum', game: 'series', kind: 'board', from: 17, copy: 'series.digitSum' },
  { tag: 'series.diffPrimes', game: 'series', kind: 'board', from: 19, copy: 'series.diffPrimes' },
  // Maze Run's winding mazes (L6-10): bushier mazes with more dead ends, the longest way they have —
  // starting at 6×6 again after the 8×8 open maze.
  { tag: 'mazeRun.winding', game: 'mazeRun', kind: 'board', from: 6, copy: 'mazeRun.winding' },
  // Make the Number's any-order bands (L10-12): the order is the player's to choose too — from three
  // numbers again, after five in fixed order.
  { tag: 'makeNumber.anyOrder', game: 'makeNumber', kind: 'rule', from: 10, copy: 'makeNumber.anyOrder' },
  // Number Hunt's memory boards (L19-26, games/schulte.ts SCHULTE_MEMORY): the numbers show, the cards
  // turn face down, tap 1 → N from memory — from 2×2 again.
  { tag: 'schulte.memory', game: 'schulte', kind: 'rule', from: 19, copy: 'schulte.memory' },
]

const BY_TAG = new Map(MECHANICS.map((m, i) => [m.tag, { ...m, bit: i }]))

export function mechanicInfo(tag: string): (MechanicInfo & { bit: number }) | undefined {
  return BY_TAG.get(tag)
}
