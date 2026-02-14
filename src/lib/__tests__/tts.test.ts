import { describe, it, expect } from 'vitest'
import { getCardTTSText, getCardAudioUrl } from '../tts'
import type { Card, CardTemplate, TemplateField } from '../../types/database'

function makeCard(overrides?: Partial<Card>): Card {
  return {
    id: 'card-1',
    deck_id: 'deck-1',
    user_id: 'user-1',
    template_id: 'tmpl-1',
    field_values: { front: 'hello', back: '안녕' },
    tags: [],
    sort_position: 0,
    srs_status: 'new',
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
    next_review_at: null,
    last_reviewed_at: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeTemplate(overrides?: Partial<CardTemplate>): CardTemplate {
  return {
    id: 'tmpl-1',
    user_id: 'user-1',
    name: 'Basic',
    fields: [
      { key: 'front', name: '앞면', type: 'text', order: 0 },
      { key: 'back', name: '뒷면', type: 'text', order: 1 },
    ] as TemplateField[],
    front_layout: [{ field_key: 'front', style: 'primary' }],
    back_layout: [{ field_key: 'back', style: 'primary' }],
    is_default: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('getCardTTSText', () => {
  it('should return the first text field value from front_layout', () => {
    const card = makeCard()
    const template = makeTemplate()
    expect(getCardTTSText(card, template)).toBe('hello')
  })

  it('should return null if no text field has a value', () => {
    const card = makeCard({ field_values: {} })
    const template = makeTemplate()
    expect(getCardTTSText(card, template)).toBeNull()
  })

  it('should skip non-text fields', () => {
    const template = makeTemplate({
      fields: [
        { key: 'img', name: 'Image', type: 'image', order: 0 },
        { key: 'front', name: '앞면', type: 'text', order: 1 },
      ] as TemplateField[],
      front_layout: [
        { field_key: 'img', style: 'media' },
        { field_key: 'front', style: 'primary' },
      ],
    })
    const card = makeCard({ field_values: { img: 'http://img.png', front: 'hello' } })
    expect(getCardTTSText(card, template)).toBe('hello')
  })
})

describe('getCardAudioUrl', () => {
  it('should return audio URL when audio field exists', () => {
    const template = makeTemplate({
      fields: [
        { key: 'front', name: '앞면', type: 'text', order: 0 },
        { key: 'audio', name: '발음', type: 'audio', order: 1 },
      ] as TemplateField[],
    })
    const card = makeCard({ field_values: { front: 'hello', audio: 'http://audio.mp3' } })
    expect(getCardAudioUrl(card, template)).toBe('http://audio.mp3')
  })

  it('should return null when no audio field', () => {
    const card = makeCard()
    const template = makeTemplate()
    expect(getCardAudioUrl(card, template)).toBeNull()
  })

  it('should return null when audio field is empty', () => {
    const template = makeTemplate({
      fields: [
        { key: 'front', name: '앞면', type: 'text', order: 0 },
        { key: 'audio', name: '발음', type: 'audio', order: 1 },
      ] as TemplateField[],
    })
    const card = makeCard({ field_values: { front: 'hello', audio: '' } })
    expect(getCardAudioUrl(card, template)).toBeNull()
  })
})
