import { describe, it, expect, vi } from 'vitest'

vi.mock('i18next', () => ({
  default: { t: (key: string) => key },
}))

import {
  validateShareMode,
  resolveAcceptAction,
  canUserModifyDeck,
  getDeckShareLabel,
  type ShareMode,
} from '../sharing'

describe('validateShareMode', () => {
  it('should accept valid share modes', () => {
    expect(validateShareMode('copy')).toBe(true)
    expect(validateShareMode('subscribe')).toBe(true)
    expect(validateShareMode('snapshot')).toBe(true)
  })

  it('should reject invalid share modes', () => {
    expect(validateShareMode('invalid')).toBe(false)
    expect(validateShareMode('')).toBe(false)
    expect(validateShareMode('COPY')).toBe(false)
  })
})

describe('resolveAcceptAction', () => {
  it('copy → copy_deck with readonly=false', () => {
    const action = resolveAcceptAction('copy')
    expect(action).toEqual({ type: 'copy_deck', readonly: false })
  })

  it('subscribe → create_subscription', () => {
    const action = resolveAcceptAction('subscribe')
    expect(action).toEqual({ type: 'create_subscription' })
  })

  it('snapshot → copy_deck with readonly=true', () => {
    const action = resolveAcceptAction('snapshot')
    expect(action).toEqual({ type: 'copy_deck', readonly: true })
  })
})

describe('canUserModifyDeck', () => {
  const baseDeck = {
    id: 'deck-1',
    user_id: 'owner-1',
    is_readonly: false,
    share_mode: null as ShareMode | null,
    source_deck_id: null as string | null,
    source_owner_id: null as string | null,
  }

  it('should allow modification of own non-readonly deck', () => {
    expect(canUserModifyDeck(baseDeck, 'owner-1')).toBe(true)
  })

  it('should block modification of readonly deck', () => {
    const deck = { ...baseDeck, is_readonly: true }
    expect(canUserModifyDeck(deck, 'owner-1')).toBe(false)
  })

  it('should block modification for subscribe deck with different user', () => {
    const deck = { ...baseDeck, share_mode: 'subscribe' as ShareMode, source_owner_id: 'other-user' }
    expect(canUserModifyDeck(deck, 'owner-1')).toBe(false)
  })

  it('should allow modification for copy deck', () => {
    const deck = { ...baseDeck, share_mode: 'copy' as ShareMode, source_owner_id: 'other-user' }
    expect(canUserModifyDeck(deck, 'owner-1')).toBe(true)
  })

  it('should block modification for non-owner', () => {
    expect(canUserModifyDeck(baseDeck, 'someone-else')).toBe(false)
  })
})

describe('getDeckShareLabel', () => {
  const baseDeck = {
    id: 'deck-1',
    user_id: 'owner-1',
    is_readonly: false,
    share_mode: null as ShareMode | null,
    source_deck_id: null as string | null,
    source_owner_id: null as string | null,
  }

  it('should return i18n key for own deck with no share mode', () => {
    expect(getDeckShareLabel(baseDeck, 'owner-1')).toBe('sharing:deckLabel.myDeck')
  })

  it('should return i18n key for subscribed deck', () => {
    const deck = { ...baseDeck, share_mode: 'subscribe' as ShareMode, source_owner_id: 'other' }
    expect(getDeckShareLabel(deck, 'owner-1')).toBe('sharing:deckLabel.subscribed')
  })

  it('should return i18n key for snapshot deck', () => {
    const deck = { ...baseDeck, share_mode: 'snapshot' as ShareMode, source_owner_id: 'other' }
    expect(getDeckShareLabel(deck, 'owner-1')).toBe('sharing:deckLabel.snapshot')
  })

  it('should return i18n key for copied deck', () => {
    const deck = { ...baseDeck, share_mode: 'copy' as ShareMode, source_owner_id: 'other' }
    expect(getDeckShareLabel(deck, 'owner-1')).toBe('sharing:deckLabel.copy')
  })
})
