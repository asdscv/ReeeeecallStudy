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
 * appear, in the game's level units (Quick Eye: its stage/variant) — placement stays below the
 * third unseen rule, so a strong first round does not open with a stack of cards.
 * Copy lives in the `brain` namespace under `mechanics.<copy>.title/body`.
 */
export type MechanicKind = 'rule' | 'board'

export interface MechanicInfo {
  tag: string
  game: BrainGameId
  kind: MechanicKind
  from: number
  copy: string
}

export const MECHANICS: readonly MechanicInfo[] = [
  // Quick Eye — by stage. Ring and crowd changes need no card: the stage-up interstitial between
  // trials says what is new (useBrainRound `stageUp`).
  { tag: 'quickEye.periphery', game: 'quickEye', kind: 'rule', from: 2, copy: 'quickEye.periphery' },
  { tag: 'quickEye.distractors', game: 'quickEye', kind: 'rule', from: 5, copy: 'quickEye.distractors' },
  { tag: 'quickEye.similar', game: 'quickEye', kind: 'rule', from: 10, copy: 'quickEye.similar' },
  { tag: 'quickEye.sameDiff', game: 'quickEye', kind: 'rule', from: 15, copy: 'quickEye.sameDiff' },
  // Odd One Out
  { tag: 'oddOneOut.rotation', game: 'oddOneOut', kind: 'rule', from: 4, copy: 'oddOneOut.rotation' },
  { tag: 'oddOneOut.lookalike', game: 'oddOneOut', kind: 'board', from: 5, copy: 'oddOneOut.lookalike' },
  { tag: 'oddOneOut.nearTwin', game: 'oddOneOut', kind: 'board', from: 10, copy: 'oddOneOut.nearTwin' },
  { tag: 'oddOneOut.glyphs', game: 'oddOneOut', kind: 'board', from: 15, copy: 'oddOneOut.glyphs' },
  { tag: 'oddOneOut.grid4', game: 'oddOneOut', kind: 'board', from: 3, copy: 'board.biggerGrid' },
  { tag: 'oddOneOut.grid5', game: 'oddOneOut', kind: 'board', from: 7, copy: 'board.biggerGrid' },
  { tag: 'oddOneOut.grid6', game: 'oddOneOut', kind: 'board', from: 12, copy: 'board.biggerGrid' },
  { tag: 'oddOneOut.grid7', game: 'oddOneOut', kind: 'board', from: 18, copy: 'board.biggerGrid' },
  // Number Hunt
  { tag: 'schulte.descending', game: 'schulte', kind: 'rule', from: 5, copy: 'schulte.descending' },
  { tag: 'schulte.reshuffle', game: 'schulte', kind: 'rule', from: 12, copy: 'schulte.reshuffle' },
  { tag: 'schulte.grid4', game: 'schulte', kind: 'board', from: 4, copy: 'board.moreNumbers' },
  { tag: 'schulte.grid5', game: 'schulte', kind: 'board', from: 9, copy: 'board.moreNumbers' },
  { tag: 'schulte.grid6', game: 'schulte', kind: 'board', from: 16, copy: 'board.moreNumbers' },
  // Flash Grid
  { tag: 'memoryGrid.grid4', game: 'memoryGrid', kind: 'board', from: 2, copy: 'board.biggerGrid' },
  { tag: 'memoryGrid.grid5', game: 'memoryGrid', kind: 'board', from: 5, copy: 'board.biggerGrid' },
  { tag: 'memoryGrid.grid6', game: 'memoryGrid', kind: 'board', from: 8, copy: 'board.biggerGrid' },
  { tag: 'memoryGrid.grid7', game: 'memoryGrid', kind: 'board', from: 12, copy: 'board.biggerGrid' },
  { tag: 'memoryGrid.fastShow', game: 'memoryGrid', kind: 'board', from: 3, copy: 'memoryGrid.fastShow' },
  // Sequence
  { tag: 'sequence.reverse', game: 'sequence', kind: 'rule', from: 4, copy: 'sequence.reverse' },
  { tag: 'sequence.grid4', game: 'sequence', kind: 'board', from: 5, copy: 'board.biggerGrid' },
  // Number Pattern — told, never shown worked out: an example would answer a reasoning puzzle.
  { tag: 'series.descending', game: 'series', kind: 'board', from: 3, copy: 'series.descending' },
  { tag: 'series.geometric', game: 'series', kind: 'board', from: 4, copy: 'series.geometric' },
  { tag: 'series.alternating', game: 'series', kind: 'board', from: 6, copy: 'series.alternating' },
  { tag: 'series.growing', game: 'series', kind: 'board', from: 8, copy: 'series.growing' },
  { tag: 'series.fibonacci', game: 'series', kind: 'board', from: 10, copy: 'series.fibonacci' },
  { tag: 'series.squares', game: 'series', kind: 'board', from: 12, copy: 'series.squares' },
  { tag: 'series.interleaved', game: 'series', kind: 'board', from: 14, copy: 'series.interleaved' },
  { tag: 'series.doublePlus', game: 'series', kind: 'board', from: 16, copy: 'series.doublePlus' },
  // Match Pairs
  { tag: 'pairs.oneFamily', game: 'pairs', kind: 'board', from: 10, copy: 'pairs.oneFamily' },
  { tag: 'pairs.noPreview', game: 'pairs', kind: 'rule', from: 22, copy: 'pairs.noPreview' },
  { tag: 'pairs.board4', game: 'pairs', kind: 'board', from: 4, copy: 'board.moreCards' },
  { tag: 'pairs.board6', game: 'pairs', kind: 'board', from: 7, copy: 'board.moreCards' },
  { tag: 'pairs.board8', game: 'pairs', kind: 'board', from: 10, copy: 'board.moreCards' },
  { tag: 'pairs.board10', game: 'pairs', kind: 'board', from: 13, copy: 'board.moreCards' },
  { tag: 'pairs.board12', game: 'pairs', kind: 'board', from: 16, copy: 'board.moreCards' },
  // Color Word
  { tag: 'stroop.word', game: 'stroop', kind: 'rule', from: 8, copy: 'stroop.word' },
  { tag: 'stroop.options3', game: 'stroop', kind: 'board', from: 2, copy: 'board.moreChoices' },
  { tag: 'stroop.options4', game: 'stroop', kind: 'board', from: 5, copy: 'board.moreChoices' },
  { tag: 'stroop.options5', game: 'stroop', kind: 'board', from: 8, copy: 'board.moreChoices' },
  { tag: 'stroop.options6', game: 'stroop', kind: 'board', from: 11, copy: 'board.moreChoices' },
  // Quick Math — the two-step kinds unlock together and share one card.
  { tag: 'math.sub', game: 'math', kind: 'board', from: 3, copy: 'math.sub' },
  { tag: 'math.mul', game: 'math', kind: 'board', from: 6, copy: 'math.mul' },
  { tag: 'math.div', game: 'math', kind: 'board', from: 10, copy: 'math.div' },
  { tag: 'math.twoStep', game: 'math', kind: 'rule', from: 14, copy: 'math.twoStep' },
  // Quick Eye's redesigned field (mid-grey, matched mask): every trial reports it. Met silently in a
  // first practice; for a returning player, a one-time notice and a recalibrated start.
  { tag: 'quickEye.clearView', game: 'quickEye', kind: 'board', from: 1, copy: 'quickEye.clearView' },
]

const BY_TAG = new Map(MECHANICS.map((m, i) => [m.tag, { ...m, bit: i }]))

export function mechanicInfo(tag: string): (MechanicInfo & { bit: number }) | undefined {
  return BY_TAG.get(tag)
}

/**
 * The level placement must stay below for this game: just under the third rule (blocking card) the
 * player has not met yet, so a strong first round opens with at most two cards.
 */
export function placementCeiling(game: BrainGameId, seen: (bit: number) => boolean): number {
  const unseen = MECHANICS.map((m, bit) => ({ ...m, bit }))
    .filter((m) => m.game === game && m.kind === 'rule' && !seen(m.bit))
    .sort((a, b) => a.from - b.from)
  return unseen.length >= 3 ? unseen[2].from - 0.01 : Infinity
}
