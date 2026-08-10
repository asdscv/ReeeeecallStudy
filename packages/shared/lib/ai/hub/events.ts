/**
 * The AI 학습 menu's event stream.
 *
 * Everything that opens an AI surface emits here — the nav submenu, the hub tiles, and the
 * "AI로 만들기" buttons inside deck and card creation. Nothing in those call sites knows who is
 * listening, which is the point: today the only subscriber is the analytics bridge on each
 * platform, and a second one (a "continue where you left off" row, a quota nudge) is a
 * `subscribe` away rather than an edit to nine call sites.
 *
 * These events describe *intent*, not money. Reservation, pricing and charging stay in
 * `packages/shared/lib/ai/server-client.ts` and the `ai-generate` edge function, which are the
 * only authority on what a request costs. A listener here must never be able to change what is
 * spent — and because `EventBus.emit` swallows listener throws, it cannot block one either.
 */
import { EventBus } from '../../kernel/event-bus'
import type { GenerateMode } from '../types'
import type { AiHubSource } from './types'

export type AiHubEvent =
  /** The hub page/screen itself was opened. */
  | { readonly type: 'ai_hub.opened'; readonly source: AiHubSource }
  /** One registered entry was chosen. `entryId` is an `AiHubEntry.id`. */
  | { readonly type: 'ai_hub.entry_opened'; readonly entryId: string; readonly source: AiHubSource }
  /**
   * The user asked for generation from somewhere outside the hub — the owner's new
   * deck-creation / card-creation buttons. `deckId` is present for `cards_only`.
   */
  | {
      readonly type: 'ai_hub.generate_requested'
      readonly mode: GenerateMode
      readonly source: AiHubSource
      readonly deckId?: string
    }

/**
 * The one bus. A module-level singleton for the same reason `DEFAULT_REGISTRY` is one: emitters
 * and subscribers live in different trees and must not have to be handed the same instance.
 */
export const aiHubBus = new EventBus<AiHubEvent>()

/** What an analytics backend is given. Matches web's `AnalyticsEvent` field-for-field. */
export interface AiHubAnalyticsEvent {
  readonly category: string
  readonly action: string
  readonly label?: string
}

/**
 * The event→analytics mapping, shared so the web and mobile bridges cannot drift into reporting
 * the same funnel under two different names.
 */
export function aiHubAnalyticsEvent(event: AiHubEvent): AiHubAnalyticsEvent {
  switch (event.type) {
    case 'ai_hub.opened':
      return { category: 'ai_hub', action: 'open', label: event.source }
    case 'ai_hub.entry_opened':
      return { category: 'ai_hub', action: 'entry_open', label: `${event.entryId}:${event.source}` }
    case 'ai_hub.generate_requested':
      return { category: 'ai_hub', action: 'generate_request', label: `${event.mode}:${event.source}` }
  }
}
