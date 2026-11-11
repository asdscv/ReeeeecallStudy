import { describe, it, expect } from 'vitest'
import { parseDeckFamily, deckListingFilter, formatDeckFamily } from '@reeeeecall/shared/lib/official-deck-family'
import { withDropOffCtas } from '@reeeeecall/shared/lib/content-drop-off'

describe('official deck family', () => {
  it('round-trips real families and rejects unknown ones', () => {
    expect(formatDeckFamily(parseDeckFamily('toeic:800')!)).toBe('toeic:800')
    expect(parseDeckFamily('ielts:6.5')).toEqual({ category: 'ielts', level: '6.5' })
    expect(parseDeckFamily('toeic:850')).toBeNull()
    expect(parseDeckFamily('jlpt:n2')).toBeNull()
    expect(parseDeckFamily(null)).toBeNull()
  })

  it('finds the deck in the reader\'s own language, English on the front', () => {
    expect(deckListingFilter({ category: 'toeic', level: '800' }, 'ko')).toEqual({ category: 'toeic', tags: ['level:800', 'source:en', 'target:ko'] })
    expect(deckListingFilter({ category: 'ielts', level: '6.5' }, 'vi-VN')).toEqual({ category: 'ielts', tags: ['level:6.5', 'source:en', 'target:vi'] })
  })

  it('has no deck for English readers, and conversation decks only for Korean readers', () => {
    expect(deckListingFilter({ category: 'toeic', level: '800' }, 'en')).toBeNull()
    expect(deckListingFilter({ category: 'conversation', level: '여행' }, 'ko')).toEqual({ category: 'conversation', tags: ['level:여행', 'source:ko', 'target:en'] })
    expect(deckListingFilter({ category: 'conversation', level: '여행' }, 'ja')).toBeNull()
  })

  it('passes the article\'s family to both drop-off CTAs', () => {
    const blocks = 'hero,paragraph,heading,paragraph,numbered_list,heading,paragraph,feature_cards,highlight_box,paragraph,cta'.split(',').map((type) => ({ type }))
    const ctas = withDropOffCtas(blocks, 'slug', 'toeic:800').filter((b) => b.type === 'app_cta')
    expect(ctas.map((b) => ('props' in b ? b.props.deckFamily : null))).toEqual(['toeic:800', 'toeic:800'])
    expect(withDropOffCtas(blocks, 'slug').filter((b) => b.type === 'app_cta').every((b) => 'props' in b && !('deckFamily' in b.props))).toBe(true)
  })
})
