import { describe, it, expect } from 'vitest'
// Retargeted at the CANONICAL prompts (packages/shared/lib/ai/prompts.ts), which is
// what ai-generate-store actually calls. This suite used to import web's own copy —
// a copy that had already drifted and lost the Chinese template/card rules, so the
// test was green while the live prompts were untested. The copy is now deleted.
import {
  buildTemplatePrompt, buildDeckPrompt, buildCardsPrompt,
} from '@reeeeecall/shared/lib/ai/prompts'

describe('buildTemplatePrompt', () => {
  it('returns system and user prompts', () => {
    const { systemPrompt, userPrompt } = buildTemplatePrompt('JLPT N3', 'en', false)
    expect(systemPrompt).toContain('flashcard template designer')
    expect(systemPrompt).toContain('field_')
    expect(systemPrompt).toContain('"default"')
    expect(userPrompt).toBe('Topic: JLPT N3')
  })

  it('includes Korean instruction for ko lang', () => {
    const { systemPrompt } = buildTemplatePrompt('한국사', 'ko', false)
    expect(systemPrompt).toContain('한국어로')
  })

  it('includes custom HTML instructions when enabled', () => {
    const { systemPrompt } = buildTemplatePrompt('test', 'en', true)
    expect(systemPrompt).toContain('custom')
    expect(systemPrompt).toContain('front_html')
    expect(systemPrompt).toContain('{{fieldName}}')
  })

  it('does not include HTML instructions when disabled', () => {
    const { systemPrompt } = buildTemplatePrompt('test', 'en', false)
    expect(systemPrompt).toContain('"default"')
    expect(systemPrompt).toContain('empty strings')
  })

  it('includes field hints when provided', () => {
    const hints = [
      { name: 'Word', side: 'front' as const },
      { name: 'Meaning', side: 'back' as const },
      { name: 'Example', side: 'back' as const },
    ]
    const { systemPrompt } = buildTemplatePrompt('vocab', 'en', false, undefined, hints)
    expect(systemPrompt).toContain('Front side fields: Word')
    expect(systemPrompt).toContain('Back side fields: Meaning, Example')
  })

  it('includes content language when provided', () => {
    const { systemPrompt } = buildTemplatePrompt('test', 'en', false, 'ja-JP')
    expect(systemPrompt).toContain('ja-JP')
    expect(systemPrompt).toContain('tts_enabled')
  })
})

describe('buildDeckPrompt', () => {
  it('returns system and user prompts', () => {
    const { systemPrompt, userPrompt } = buildDeckPrompt('English Vocab', 'en')
    expect(systemPrompt).toContain('flashcard deck creator')
    expect(systemPrompt).toContain('#3B82F6')
    expect(userPrompt).toBe('Topic: English Vocab')
  })

  it('includes Korean instruction for ko lang', () => {
    const { systemPrompt } = buildDeckPrompt('한국어', 'ko')
    expect(systemPrompt).toContain('한국어로')
  })
})

describe('buildCardsPrompt', () => {
  const fields = [
    { key: 'field_word', name: 'Word', type: 'text' as const, order: 0, tts_lang: 'en-US' },
    { key: 'field_meaning', name: 'Meaning', type: 'text' as const, order: 1 },
  ]

  it('returns system and user prompts', () => {
    const { systemPrompt, userPrompt } = buildCardsPrompt('TOEIC', fields, 20)
    expect(systemPrompt).toContain('20 flashcards')
    expect(systemPrompt).toContain('field_word')
    expect(systemPrompt).toContain('field_meaning')
    expect(userPrompt).toBe('Topic: TOEIC')
  })

  it('includes existing cards for dedup', () => {
    const existing = [{ field_word: 'apple', field_meaning: '사과' }]
    const { systemPrompt } = buildCardsPrompt('fruit', fields, 10, existing)
    expect(systemPrompt).toContain('EXISTING CARDS')
    expect(systemPrompt).toContain('apple')
  })

  it('does not include dedup when no existing cards', () => {
    const { systemPrompt } = buildCardsPrompt('test', fields, 10)
    expect(systemPrompt).not.toContain('EXISTING CARDS')
  })
})

// ─── The rules the deleted duplicate had lost ───────────────────────────────
// web/src/lib/ai/prompts.ts was a stale copy missing exactly this: the Chinese
// character/pinyin guidance. Its own test passed because it read the copy. These
// assertions exist so a future divergence between the canonical prompts and what the
// product needs fails here instead of shipping Chinese decks with no 汉字 field.
describe('Chinese language rules (canonical prompts only)', () => {
  it('demands a dedicated character field and a separate pinyin field for zh-CN', () => {
    const { systemPrompt } = buildTemplatePrompt('HSK 4', 'en', false, 'zh-CN')
    expect(systemPrompt).toContain('Simplified Chinese')
    expect(systemPrompt).toContain('pinyin')
  })

  it('uses Traditional characters for zh-TW', () => {
    const { systemPrompt } = buildTemplatePrompt('TOCFL', 'en', false, 'zh-TW')
    expect(systemPrompt).toContain('Traditional Chinese')
  })

  it('says nothing about Chinese for a non-Chinese deck', () => {
    const { systemPrompt } = buildTemplatePrompt('JLPT N3', 'en', false, 'ja')
    expect(systemPrompt).not.toContain('Simplified Chinese')
    expect(systemPrompt).not.toContain('Traditional Chinese')
  })
})
