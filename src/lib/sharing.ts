export type ShareMode = 'copy' | 'subscribe' | 'snapshot'

const VALID_SHARE_MODES: ShareMode[] = ['copy', 'subscribe', 'snapshot']

export type AcceptAction =
  | { type: 'copy_deck'; readonly: boolean }
  | { type: 'create_subscription' }

export interface ShareableDeck {
  id: string
  user_id: string
  is_readonly: boolean
  share_mode: ShareMode | null
  source_deck_id: string | null
  source_owner_id: string | null
}

export function validateShareMode(mode: string): mode is ShareMode {
  return VALID_SHARE_MODES.includes(mode as ShareMode)
}

export function resolveAcceptAction(shareMode: ShareMode): AcceptAction {
  switch (shareMode) {
    case 'copy':
      return { type: 'copy_deck', readonly: false }
    case 'subscribe':
      return { type: 'create_subscription' }
    case 'snapshot':
      return { type: 'copy_deck', readonly: true }
  }
}

export function canUserModifyDeck(deck: ShareableDeck, userId: string): boolean {
  if (deck.user_id !== userId) return false
  if (deck.is_readonly) return false
  if (deck.share_mode === 'subscribe' && deck.source_owner_id && deck.source_owner_id !== userId) {
    return false
  }
  return true
}

export function getDeckShareLabel(deck: ShareableDeck, _userId: string): string {
  if (!deck.share_mode || !deck.source_owner_id) return '내 덱'

  switch (deck.share_mode) {
    case 'subscribe':
      return '구독 중'
    case 'snapshot':
      return '스냅샷'
    case 'copy':
      return '복사본'
    default:
      return '내 덱'
  }
}
