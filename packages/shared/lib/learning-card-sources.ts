// ─── Where a card's SRS state actually lives, for planning ───────────────────
//
// A card's schedule is not always on the card row. A learner who OWNS the deck has their SRS
// embedded in `cards`; a learner who SUBSCRIBED to someone else's deck studies the publisher's
// card rows and keeps their own schedule in `user_card_progress` (see `./srs-access.ts`, and
// `acquire_listing`, which seeds those rows).
//
// The study flow has known this since mig 009. The daily planner did not: it read
// `cards.interval_days` / `last_reviewed_at` / `next_review_at` directly for every deck. On a
// subscribed or official deck those columns hold the PUBLISHER's state — in production, all
// 376,095 official cards carry `interval_days = 0` and `last_reviewed_at = NULL` — so every
// memory feature evaluated to the same no-evidence value and the "personalised" plan degenerated
// to whatever order the rows arrived in.
//
// This module is the pure half of the fix: given the decks a goal points at, say which ones need
// the progress table. The store does the two reads; the rule lives here so it can be tested
// without a database and shared by any other surface that plans over mixed decks.
import { getSrsSource, mergeCardWithProgress, type SrsDeckMeta, type UserCardProgress } from './srs-access'
import type { Card } from '../types/database'

/** The deck fields `getSrsSource` needs, plus the id to group by. */
export interface PlannerDeckMeta extends SrsDeckMeta {
  readonly id: string
}

export interface DeckSourceSplit {
  /** Decks whose SRS is on the card row — the learner owns them. */
  readonly embeddedDeckIds: string[]
  /** Decks whose SRS is in `user_card_progress` — the learner subscribed to them. */
  readonly progressDeckIds: string[]
}

/**
 * Split a goal's decks by where each one's SRS state is kept.
 *
 * Ownership is the discriminator, exactly as in `getSrsSource` — deliberately NOT `share_mode`
 * or `source_owner_id`, both of which are NULL for regular-user subscribe decks and for the
 * official decks. A deck missing from `decks` is omitted from both lists rather than guessed
 * into one: planning a deck we could not read the ownership of would pick a schedule source by
 * coin flip, and the two sources disagree.
 */
export function splitDecksBySrsSource(
  decks: readonly PlannerDeckMeta[],
  currentUserId: string,
): DeckSourceSplit {
  const embeddedDeckIds: string[] = []
  const progressDeckIds: string[] = []
  for (const deck of decks) {
    if (getSrsSource(deck, currentUserId) === 'embedded') embeddedDeckIds.push(deck.id)
    else progressDeckIds.push(deck.id)
  }
  return { embeddedDeckIds, progressDeckIds }
}

/**
 * Attach each subscriber's own schedule to the publisher's card rows.
 *
 * A card with no progress row is a card the learner has never studied. `mergeCardWithProgress`
 * already renders that as a new card (interval 0, no last review), which the memory model reads
 * as "no forgetting curve yet" and the planner scores on its remaining features. That is the
 * correct reading and the reason this does not drop such cards.
 */
export function attachProgressToCards(
  cards: readonly Card[],
  progressRows: readonly UserCardProgress[],
): Card[] {
  const byCardId = new Map(progressRows.map((row) => [row.card_id, row]))
  return cards.map((card) => mergeCardWithProgress(card, byCardId.get(card.id)) as Card)
}

/**
 * Is this card due, per the schedule now attached to it?
 *
 * Applied in memory for progress-sourced cards because the due filter cannot be pushed into the
 * card query: the column it would filter on belongs to the publisher. `null` is due — a card
 * never studied is the most due thing there is, which is how the embedded query treats it too.
 */
export function isDueAt(nextReviewAt: string | null | undefined, nowIso: string): boolean {
  if (!nextReviewAt) return true
  const due = Date.parse(nextReviewAt)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(due) || !Number.isFinite(now)) return true
  return due <= now
}
