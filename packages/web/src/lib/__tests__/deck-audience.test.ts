/**
 * The second audience the catalog never addressed.
 *
 * Official decks ship as en↔X pairs in both directions, and `DeckMetadataI18n` renders
 * every one of them in the non-English side: a `ko → en` deck is titled in Korean and
 * labelled `native_language='ko'`, because it was conceived as "a Korean practising
 * English".
 *
 * The same rows are also Korean-with-English-answers — 327 decks, 192,548 cards — which
 * is what an English speaker learning Korean needs. They were invisible: filtering the
 * marketplace as an English speaker returned zero decks, and the stored titles are in
 * Korean, Japanese, Thai and so on, which an English speaker cannot read.
 *
 * These are the production tag shapes, copied from the live catalog.
 */
import { describe, it, expect } from 'vitest'
import {
  readDeckFacts,
  audienceLanguages,
  taughtLanguage,
  storedTitleLanguage,
  localizedOfficialTitle,
} from '@reeeeecall/shared/lib/deck-audience'

const REVERSE_KO = ['official', 'category:beginner', 'lang:ko-en', 'source:ko', 'target:en', 'learning_language:en', 'level:batch-2']
const FORWARD_KO = ['official', 'category:beginner', 'lang:en-ko', 'source:en', 'target:ko', 'level:batch-2']
const CONVERSATION = ['official', 'category:conversation', 'source:ko', 'target:en', 'level:여행']
const TOEIC_ID = ['official', 'category:toeic', 'source:id', 'target:en', 'level:600']
const NO_LEVEL = ['official', 'category:beginner', 'source:ja', 'target:en']

describe('readDeckFacts', () => {
  it('pulls direction and category out of the tag list', () => {
    expect(readDeckFacts(REVERSE_KO)).toEqual({
      category: 'beginner', level: 'batch-2', source: 'ko', target: 'en',
    })
  })

  it('survives a listing with no tags', () => {
    expect(readDeckFacts([])).toEqual({ category: null, level: null, source: null, target: null })
    expect(readDeckFacts(null)).toEqual({ category: null, level: null, source: null, target: null })
  })
})

describe('audienceLanguages', () => {
  it('reports both sides of the pair, not just the stored one', () => {
    expect(audienceLanguages(readDeckFacts(REVERSE_KO)).sort()).toEqual(['en', 'ko'])
  })
})

describe('taughtLanguage', () => {
  // The whole point: the same row teaches different things to the two audiences.
  it('teaches English to the Korean speaker', () => {
    expect(taughtLanguage(readDeckFacts(REVERSE_KO), 'ko')).toBe('en')
  })

  it('teaches Korean to the English speaker', () => {
    expect(taughtLanguage(readDeckFacts(REVERSE_KO), 'en')).toBe('ko')
  })

  it('says nothing for a viewer outside the pair rather than guessing', () => {
    expect(taughtLanguage(readDeckFacts(REVERSE_KO), 'ja')).toBeNull()
  })
})

describe('storedTitleLanguage', () => {
  it('is the non-English side for both directions', () => {
    expect(storedTitleLanguage(readDeckFacts(REVERSE_KO))).toBe('ko')
    expect(storedTitleLanguage(readDeckFacts(FORWARD_KO))).toBe('ko')
  })
})

describe('localizedOfficialTitle', () => {
  it('names the language an English speaker is actually learning', () => {
    // Not "Beginner English Vocabulary" — that is the Korean learner's view of this row.
    expect(localizedOfficialTitle(readDeckFacts(REVERSE_KO), 'en'))
      .toBe('Beginner Korean Vocabulary — Batch 2 (Korean → English)')
  })

  it('drops the batch suffix when the deck has no level tag', () => {
    expect(localizedOfficialTitle(readDeckFacts(NO_LEVEL), 'en'))
      .toBe('Beginner Japanese Vocabulary (Japanese → English)')
  })

  it('translates the conversation topic, which is stored as a Korean word', () => {
    expect(localizedOfficialTitle(readDeckFacts(CONVERSATION), 'en'))
      .toBe('Real Korean Conversation — Travel (Korean → English)')
  })

  it('keeps the exam name and score', () => {
    expect(localizedOfficialTitle(readDeckFacts(TOEIC_ID), 'en'))
      .toBe('TOEIC 600 Indonesian Vocabulary (Indonesian → English)')
  })

  // Everyone else already reads the stored title in their own language; regenerating it
  // would risk drifting from what the import pipeline wrote.
  it('leaves the stored title alone for the audience it was written for', () => {
    expect(localizedOfficialTitle(readDeckFacts(REVERSE_KO), 'ko')).toBeNull()
    expect(localizedOfficialTitle(readDeckFacts(FORWARD_KO), 'ko')).toBeNull()
  })

  it('stays silent for a viewer outside the pair', () => {
    expect(localizedOfficialTitle(readDeckFacts(REVERSE_KO), 'th')).toBeNull()
  })

  it('stays silent when the tags are too thin to describe the deck', () => {
    expect(localizedOfficialTitle(readDeckFacts(['official']), 'en')).toBeNull()
    expect(localizedOfficialTitle(readDeckFacts(['source:ko', 'target:en']), 'en')).toBeNull()
  })
})
