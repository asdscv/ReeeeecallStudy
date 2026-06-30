// Sync-guard: the server-side prompt builder (supabase/functions/_shared/ai-prompts.ts)
// must produce BYTE-IDENTICAL prompts to the proven client builder. The server is
// now the sole runtime prompt source; this catches any future drift between them.
import { describe, it, expect } from 'vitest'
// Oracle = the canonical SHARED builder (the shared store uses this at runtime;
// web's own lib/ai/prompts.ts is a stale, unused-for-generation duplicate).
import {
  buildTemplatePrompt as oracleTemplate,
  buildDeckPrompt as oracleDeck,
  buildCardsPrompt as oracleCards,
} from '../../../../../../packages/shared/lib/ai/prompts'
import {
  buildTemplatePrompt as serverTemplate,
  buildDeckPrompt as serverDeck,
  buildCardsPrompt as serverCards,
} from '../../../../../../supabase/functions/_shared/ai-prompts'

const fields = [
  { key: 'field_word', name: '단어', type: 'text' as const, order: 0, tts_lang: 'ja-JP' },
  { key: 'field_meaning', name: '뜻', type: 'text' as const, order: 1 },
]

describe('server ai-prompts parity with the canonical client builder', () => {
  it('template prompt matches (ko UI, ja content, field hints)', () => {
    const args = ['기초 일본어', 'ko', false, 'ja-JP', [{ name: '단어', side: 'front' as const }]] as const
    expect(serverTemplate(...args)).toEqual(oracleTemplate(...args))
  })

  it('template prompt matches (en UI, custom HTML, no hints)', () => {
    expect(serverTemplate('travel english', 'en', true)).toEqual(oracleTemplate('travel english', 'en', true))
  })

  it('template prompt matches (Chinese — adds hanzi/pinyin guidance)', () => {
    expect(serverTemplate('HSK 1', 'ko', false, 'zh-CN')).toEqual(oracleTemplate('HSK 1', 'ko', false, 'zh-CN'))
  })

  it('deck prompt matches (ko + en)', () => {
    expect(serverDeck('여행 영어', 'ko')).toEqual(oracleDeck('여행 영어', 'ko'))
    expect(serverDeck('travel', 'en')).toEqual(oracleDeck('travel', 'en'))
  })

  it('cards prompt matches (plain)', () => {
    expect(serverCards('fruits', fields, 20)).toEqual(oracleCards('fruits', fields, 20))
  })

  it('cards prompt matches (existing cards dedup + Chinese)', () => {
    const zh = [{ key: 'field_hanzi', name: '汉字', type: 'text' as const, order: 0, tts_lang: 'zh-CN' }]
    const existing = [{ field_hanzi: '你好' }, { field_hanzi: '谢谢' }]
    expect(serverCards('HSK1', zh, 10, existing)).toEqual(oracleCards('HSK1', zh, 10, existing))
  })
})
