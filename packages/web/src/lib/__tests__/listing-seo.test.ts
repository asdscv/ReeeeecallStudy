import { describe, it, expect } from 'vitest'
import {
  wordListPageLanguage, wordListHeading, wordListDescription, wordListCta, wordListHreflang, wordRows, wordListColumns,
  type ListingSeoInput,
} from '@reeeeecall/shared/lib/listing-seo'

const word = (front: string, back: string) => ({ field_values: { kind: 'word', front, back, example_front: `Use ${front}.`, example_back: `${back} 예문` } })

function deck(over: Partial<ListingSeoInput> = {}): ListingSeoInput {
  return {
    id: 'd1',
    title: 'TOEIC 800 어휘 (영어 → 한국어)',
    category: 'toeic',
    card_count: 1500,
    tags: ['official', 'category:toeic', 'source:en', 'target:ko', 'level:800'],
    owner_is_official: true,
    native_language: 'ko',
    siblings: [{ id: 'd-ja', native_language: 'ja' }, { id: 'd-vi', native_language: 'vi' }],
    sample_fields: Array.from({ length: 50 }, (_, i) => word(`word${i}`, `뜻${i}`)),
    ...over,
  }
}

describe('word-list page language', () => {
  it('is the deck language for official decks, and none for user decks', () => {
    expect(wordListPageLanguage(deck())).toBe('ko')
    expect(wordListPageLanguage(deck({ owner_is_official: false }))).toBeNull()
    expect(wordListPageLanguage(deck({ native_language: 'en' }))).toBeNull()
  })
})

describe('heading = the phrase people search for', () => {
  it.each([
    ['ko', '토익 800점 단어 1,500개 — 뜻·예문 (영어 → 한국어)'],
    ['ja', 'TOEIC 800点 英単語1,500語 — 意味・例文 (영어 → 한국어)'],
    ['zh', '托业800分词汇1,500个 — 释义与例句 (영어 → 한국어)'],
    ['vi', 'Từ vựng TOEIC 800 — 1.500 từ kèm nghĩa và ví dụ (영어 → 한국어)'],
    ['es', 'Vocabulario TOEIC 800 — 1500 palabras con significado y ejemplos (영어 → 한국어)'],
  ] as const)('%s', (lang, expected) => {
    expect(wordListHeading(deck(), lang)).toBe(expected)
  })

  it('keeps a deck and its reverse apart', () => {
    const reverse = deck({ title: 'TOEIC 800 어휘 (한국어 → 영어)', tags: ['official', 'source:ko', 'target:en', 'level:800'] })
    expect(wordListHeading(reverse, 'ko')).not.toBe(wordListHeading(deck(), 'ko'))
  })

  it('keeps Japanese and Chinese decks apart from their reverse too (full-width brackets)', () => {
    const ja = deck({ native_language: 'ja', title: 'TOEIC 800 単語（英語 → 日本語）' })
    const jaReverse = deck({ native_language: 'ja', title: 'TOEIC 800 単語（日本語 → 英語）', tags: ['source:ja', 'target:en', 'level:800'] })
    expect(wordListHeading(ja, 'ja')).toBe('TOEIC 800点 英単語1,500語 — 意味・例文 (英語 → 日本語)')
    expect(wordListHeading(jaReverse, 'ja')).toBe('TOEIC 800点 英単語1,500語 — 意味・例文 (日本語 → 英語)')
  })

  it('uses the band without a unit for IELTS in Korean', () => {
    expect(wordListHeading(deck({ category: 'ielts', title: 'IELTS 6.5 어휘 (영어 → 한국어)', tags: ['source:en', 'level:6.5'] }), 'ko'))
      .toBe('아이엘츠 6.5 단어 1,500개 — 뜻·예문 (영어 → 한국어)')
  })

  it('names conversation decks as expressions, in the phrase people search for', () => {
    const talk = deck({ category: 'conversation', title: '실전 영어 회화 — 여행 (한국어 → 영어)', card_count: 1500, tags: ['source:ko', 'target:en', 'level:여행'] })
    expect(wordListHeading(talk, 'ko')).toBe('여행 영어 회화 표현 1,500개 — 뜻·상황별 예시 (한국어 → 영어)')
    expect(wordListColumns('ko', 'conversation')).toEqual(['영어 표현', '뜻', '다른 표현 · 상황'])
  })

  it('falls back to the deck title for other decks', () => {
    const general = deck({ category: 'beginner', title: '초급 영단어 — 7탄 (영어 → 한국어)', card_count: 301, tags: ['source:en', 'level:batch-7'] })
    expect(wordListHeading(general, 'ko')).toBe('초급 영단어 — 7탄: 단어 301개·뜻·예문 (영어 → 한국어)')
    expect(wordListColumns('ko', 'beginner')).toEqual(['단어', '뜻', '예문'])
  })

  it('states how many words are shown and how many remain', () => {
    expect(wordListDescription(deck(), 'ko')).toContain('50개 단어')
    expect(wordListCta(deck(), 'ko')).toBe('나머지 1,450개는 간격 반복으로 학습하기')
  })
})

describe('hreflang cluster', () => {
  it('links the same exam level in every native language, one URL per deck', () => {
    expect(wordListHreflang(deck(), 'https://x')).toEqual([
      { lang: 'ko', href: 'https://x/d/d1' },
      { lang: 'ja', href: 'https://x/d/d-ja' },
      { lang: 'vi', href: 'https://x/d/d-vi' },
    ])
  })
})

describe('word rows put English in the term column', () => {
  it('English → X decks: front is English', () => {
    expect(wordRows(deck({ sample_fields: [word('adjudicate', '판결하다')] }))[0])
      .toEqual({ term: 'adjudicate', meaning: '판결하다', example: 'Use adjudicate.', exampleNote: '판결하다 예문' })
  })

  it('X → English decks: back is English', () => {
    const reverse = deck({ tags: ['source:ko', 'target:en'], sample_fields: [{ field_values: { kind: 'word', front: '판결하다', back: 'adjudicate', example_front: '위원회가 판결할 것이다.', example_back: 'The committee will adjudicate.' } }] })
    expect(wordRows(reverse)[0]).toEqual({ term: 'adjudicate', meaning: '판결하다', example: 'The committee will adjudicate.', exampleNote: '위원회가 판결할 것이다.' })
  })

  it('conversation phrases: English expression, Korean meaning, alternative and situation', () => {
    const talk = deck({ tags: ['source:ko', 'target:en'], sample_fields: [{ field_values: { kind: 'phrase', front: '이쪽이 맞나요?', back: 'Am I going the right way?', alt: 'Is this the right direction?', situation: '길 물어볼 때' } }] })
    expect(wordRows(talk)[0]).toEqual({ term: 'Am I going the right way?', meaning: '이쪽이 맞나요?', example: 'Is this the right direction?', exampleNote: '길 물어볼 때' })
  })

  it('strips quotes some imported decks wrap around example sentences', () => {
    const quoted = deck({ sample_fields: [{ field_values: { kind: 'word', front: 'deteriorate', back: '悪化する', example_front: '"Air quality tends to deteriorate."', example_back: '"空気の質が悪化する。"' } }] })
    expect(wordRows(quoted)[0]).toMatchObject({ example: 'Air quality tends to deteriorate.', exampleNote: '空気の質が悪化する。' })
  })

  it('drops cards without both a term and a meaning', () => {
    expect(wordRows(deck({ sample_fields: [{ field_values: { front: 'only' } }] }))).toEqual([])
  })
})
