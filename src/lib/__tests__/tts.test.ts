import { describe, it, expect } from 'vitest'
import { getCardTTSText, getCardAudioUrl, getTTSFieldsForLayout } from '../tts'
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
    layout_mode: 'default',
    front_html: '',
    back_html: '',
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

describe('getTTSFieldsForLayout', () => {
  it('should return TTS-enabled text fields with their text and lang', () => {
    const template = makeTemplate({
      fields: [
        { key: 'front', name: '앞면', type: 'text', order: 0, tts_enabled: true, tts_lang: 'en-US' },
        { key: 'back', name: '뒷면', type: 'text', order: 1, tts_enabled: true, tts_lang: 'ko-KR' },
      ] as TemplateField[],
    })
    const card = makeCard()

    const result = getTTSFieldsForLayout(card, template, 'front')
    expect(result).toEqual([
      { fieldKey: 'front', text: 'hello', lang: 'en-US' },
    ])

    const backResult = getTTSFieldsForLayout(card, template, 'back')
    expect(backResult).toEqual([
      { fieldKey: 'back', text: '안녕', lang: 'ko-KR' },
    ])
  })

  it('should return empty array when no fields have TTS enabled', () => {
    const card = makeCard()
    const template = makeTemplate()
    expect(getTTSFieldsForLayout(card, template, 'front')).toEqual([])
  })

  it('should skip non-text fields even if tts_enabled', () => {
    const template = makeTemplate({
      fields: [
        { key: 'img', name: 'Image', type: 'image', order: 0, tts_enabled: true, tts_lang: 'en-US' },
        { key: 'front', name: '앞면', type: 'text', order: 1, tts_enabled: true, tts_lang: 'en-US' },
      ] as TemplateField[],
      front_layout: [
        { field_key: 'img', style: 'media' },
        { field_key: 'front', style: 'primary' },
      ],
    })
    const card = makeCard({ field_values: { img: 'http://img.png', front: 'hello' } })

    const result = getTTSFieldsForLayout(card, template, 'front')
    expect(result).toEqual([
      { fieldKey: 'front', text: 'hello', lang: 'en-US' },
    ])
  })

  it('should skip fields with empty values', () => {
    const template = makeTemplate({
      fields: [
        { key: 'front', name: '앞면', type: 'text', order: 0, tts_enabled: true, tts_lang: 'en-US' },
      ] as TemplateField[],
    })
    const card = makeCard({ field_values: { front: '' } })
    expect(getTTSFieldsForLayout(card, template, 'front')).toEqual([])
  })

  it('should default lang to en-US when tts_lang not set', () => {
    const template = makeTemplate({
      fields: [
        { key: 'front', name: '앞면', type: 'text', order: 0, tts_enabled: true },
      ] as TemplateField[],
    })
    const card = makeCard()

    const result = getTTSFieldsForLayout(card, template, 'front')
    expect(result).toEqual([
      { fieldKey: 'front', text: 'hello', lang: 'en-US' },
    ])
  })

  it('should return multiple TTS fields in layout order', () => {
    const template = makeTemplate({
      fields: [
        { key: 'word', name: '단어', type: 'text', order: 0, tts_enabled: true, tts_lang: 'en-US' },
        { key: 'sentence', name: '예문', type: 'text', order: 1, tts_enabled: true, tts_lang: 'en-US' },
        { key: 'meaning', name: '뜻', type: 'text', order: 2 },
      ] as TemplateField[],
      back_layout: [
        { field_key: 'meaning', style: 'primary' },
        { field_key: 'word', style: 'secondary' },
        { field_key: 'sentence', style: 'hint' },
      ],
    })
    const card = makeCard({
      field_values: { word: 'apple', sentence: 'I ate an apple', meaning: '사과' },
    })

    const result = getTTSFieldsForLayout(card, template, 'back')
    expect(result).toEqual([
      { fieldKey: 'word', text: 'apple', lang: 'en-US' },
      { fieldKey: 'sentence', text: 'I ate an apple', lang: 'en-US' },
    ])
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
