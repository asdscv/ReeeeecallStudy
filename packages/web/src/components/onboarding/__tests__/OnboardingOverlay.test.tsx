import { describe, it, expect } from 'vitest'
import { getSampleDeck, getSampleCards } from '../../../lib/onboarding-samples'

describe('onboarding-samples', () => {
  describe('getSampleDeck', () => {
    it('returns Korean deck for ko locale', () => {
      const deck = getSampleDeck('ko')
      expect(deck.name).toBe('영어 단어장')
      expect(deck.description).toBeTruthy()
    })

    it('returns Japanese deck for ja locale', () => {
      const deck = getSampleDeck('ja')
      expect(deck.name).toBe('英単語帳')
    })

    it('returns Chinese deck for zh locale', () => {
      const deck = getSampleDeck('zh')
      expect(deck.name).toBe('英语词汇')
    })

    it('returns English deck for unknown locale', () => {
      const deck = getSampleDeck('xx')
      expect(deck.name).toBe('English Vocabulary')
    })

    it('returns English deck for en locale', () => {
      const deck = getSampleDeck('en')
      expect(deck.name).toBe('English Vocabulary')
    })
  })

  describe('getSampleCards', () => {
    it('returns 5 cards for ko locale', () => {
      const cards = getSampleCards('ko')
      expect(cards.length).toBe(5)
      expect(cards[0].word).toBe('apple')
      expect(cards[0].meaning).toBe('사과')
    })

    it('returns 5 cards for ja locale', () => {
      const cards = getSampleCards('ja')
      expect(cards.length).toBe(5)
      expect(cards[0].meaning).toBe('りんご')
    })

    it('returns 5 cards for zh locale', () => {
      const cards = getSampleCards('zh')
      expect(cards.length).toBe(5)
      expect(cards[0].meaning).toBe('苹果')
    })

    it('returns English definitions for unknown locale', () => {
      const cards = getSampleCards('xx')
      expect(cards.length).toBe(5)
      expect(cards[0].word).toBe('apple')
    })

    it('each card has word and meaning', () => {
      const cards = getSampleCards('ko')
      for (const card of cards) {
        expect(card.word).toBeTruthy()
        expect(card.meaning).toBeTruthy()
      }
    })

    it('returns cards for all supported languages', () => {
      const langs = ['ko', 'ja', 'zh', 'es', 'vi', 'th', 'id', 'en']
      for (const lang of langs) {
        const cards = getSampleCards(lang)
        expect(cards.length).toBeGreaterThan(0)
      }
    })
  })
})
