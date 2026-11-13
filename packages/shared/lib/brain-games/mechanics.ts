import type { BrainGameId } from './types'

/**
 * Every rule or board change a game introduces as the level climbs — so the player is told when
 * something new appears, the first time it appears, instead of meeting it cold inside a timed trial.
 *
 * - 'rule': a new thing to DO (count down, pick the word, tap in reverse). A card stops the trial
 *   before it starts, and that trial is played unscored.
 * - 'board': the same task, bigger or faster. A short notice between trials; never blocks.
 *
 * Append-only: a mechanic's index is its bit in BrainMeta.seen. `from` is where it first can
 * appear, in the game's level units (Quick Eye: its stage/variant). Board games gate new rules in
 * the round (ctx.blockRules); Quick Eye's placement stays below its third unseen rule.
 * Copy lives in the `brain` namespace under `mechanics.<copy>.title/body`.
 */
export type MechanicKind = 'rule' | 'board'

export interface MechanicInfo {
  tag: string
  game: BrainGameId
  kind: MechanicKind
  from: number
  copy: string
  /** No longer produced (its content was removed). Kept so the bits after it never move. */
  retired?: true
}

export const MECHANICS: readonly MechanicInfo[] = [
  // Quick Eye — by stage. Ring and crowd changes need no card: the stage-up interstitial between
  // trials says what is new (useBrainRound `stageUp`).
  { tag: 'quickEye.periphery', game: 'quickEye', kind: 'rule', from: 2, copy: 'quickEye.periphery' },
  { tag: 'quickEye.distractors', game: 'quickEye', kind: 'rule', from: 5, copy: 'quickEye.distractors' },
  { tag: 'quickEye.similar', game: 'quickEye', kind: 'rule', from: 10, copy: 'quickEye.similar' },
  { tag: 'quickEye.sameDiff', game: 'quickEye', kind: 'rule', from: 15, copy: 'quickEye.sameDiff' },
  // Odd One Out
  { tag: 'oddOneOut.rotation', game: 'oddOneOut', kind: 'rule', from: 5, copy: 'oddOneOut.rotation' },
  { tag: 'oddOneOut.lookalike', game: 'oddOneOut', kind: 'board', from: 3, copy: 'oddOneOut.lookalike' },
  { tag: 'oddOneOut.nearTwin', game: 'oddOneOut', kind: 'board', from: 10, copy: 'oddOneOut.nearTwin', retired: true },
  { tag: 'oddOneOut.glyphs', game: 'oddOneOut', kind: 'board', from: 7, copy: 'oddOneOut.glyphs' },
  { tag: 'oddOneOut.grid4', game: 'oddOneOut', kind: 'board', from: 3, copy: 'board.biggerGrid' },
  { tag: 'oddOneOut.grid5', game: 'oddOneOut', kind: 'board', from: 6, copy: 'board.biggerGrid' },
  { tag: 'oddOneOut.grid6', game: 'oddOneOut', kind: 'board', from: 12, copy: 'board.biggerGrid' },
  { tag: 'oddOneOut.grid7', game: 'oddOneOut', kind: 'board', from: 18, copy: 'board.biggerGrid' },
  // Number Hunt
  { tag: 'schulte.descending', game: 'schulte', kind: 'rule', from: 5, copy: 'schulte.descending' },
  { tag: 'schulte.reshuffle', game: 'schulte', kind: 'rule', from: 14, copy: 'schulte.reshuffle' },
  { tag: 'schulte.grid4', game: 'schulte', kind: 'board', from: 3, copy: 'board.moreNumbers' },
  { tag: 'schulte.grid5', game: 'schulte', kind: 'board', from: 6, copy: 'board.moreNumbers' },
  { tag: 'schulte.grid6', game: 'schulte', kind: 'board', from: 18, copy: 'board.moreNumbers' },
  // Flash Grid — board size by area, portrait and landscape alike: 16, 24, 30, 35 cells (§3.6).
  { tag: 'memoryGrid.grid4', game: 'memoryGrid', kind: 'board', from: 2, copy: 'board.biggerGrid' },
  { tag: 'memoryGrid.grid5', game: 'memoryGrid', kind: 'board', from: 5, copy: 'board.biggerGrid' },
  { tag: 'memoryGrid.grid6', game: 'memoryGrid', kind: 'board', from: 8, copy: 'board.biggerGrid' },
  { tag: 'memoryGrid.grid7', game: 'memoryGrid', kind: 'board', from: 11, copy: 'board.biggerGrid' },
  { tag: 'memoryGrid.fastShow', game: 'memoryGrid', kind: 'board', from: 14, copy: 'memoryGrid.fastShow' },
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
  // Quick Eye's redesigned field (mid-grey, matched mask): every trial reports it. Met silently in a
  // first practice; for a returning player, a one-time notice and a recalibrated start.
  { tag: 'quickEye.clearView', game: 'quickEye', kind: 'board', from: 1, copy: 'quickEye.clearView' },
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
  // Odd One Out — colour noise, mirror, «없음», glyph twins (§3.3).
  { tag: 'oddOneOut.colorNoise', game: 'oddOneOut', kind: 'board', from: 10, copy: 'oddOneOut.colorNoise' },
  { tag: 'oddOneOut.mirror', game: 'oddOneOut', kind: 'rule', from: 12, copy: 'oddOneOut.mirror' },
  { tag: 'oddOneOut.absent', game: 'oddOneOut', kind: 'rule', from: 16, copy: 'oddOneOut.absent' },
  { tag: 'oddOneOut.glyphTwin', game: 'oddOneOut', kind: 'board', from: 17, copy: 'oddOneOut.glyphTwin' },
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
  { tag: 'memoryGrid.waves', game: 'memoryGrid', kind: 'board', from: 13, copy: 'memoryGrid.waves' },
  // Match Pairs — look-alike pictures, triples (§3.8).
  { tag: 'pairs.lookalike', game: 'pairs', kind: 'board', from: 8, copy: 'pairs.lookalike' },
  { tag: 'pairs.triples', game: 'pairs', kind: 'rule', from: 14, copy: 'pairs.triples' },
]

const BY_TAG = new Map(MECHANICS.map((m, i) => [m.tag, { ...m, bit: i }]))

export function mechanicInfo(tag: string): (MechanicInfo & { bit: number }) | undefined {
  return BY_TAG.get(tag)
}

/**
 * The level placement must stay below for this game: just under the third rule (blocking card) the
 * player has not met yet, so a strong first round opens with at most two cards. Retired rules
 * never count (they are not produced). Board games now gate rules in the round instead
 * (ctx.blockRules); Quick Eye still uses this.
 */
export function placementCeiling(game: BrainGameId, seen: (bit: number) => boolean): number {
  const unseen = MECHANICS.map((m, bit) => ({ ...m, bit }))
    .filter((m) => m.game === game && m.kind === 'rule' && !m.retired && !seen(m.bit))
    .sort((a, b) => a.from - b.from)
  return unseen.length >= 3 ? unseen[2].from - 0.01 : Infinity
}
