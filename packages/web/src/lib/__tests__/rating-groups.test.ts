import { describe, it, expect } from 'vitest'
import {
  RATING_GROUP_REGISTRY,
  EXCLUDED_RATINGS,
  STUDY_MODE_TO_GROUP,
  RATING_COLOR_MAP,
} from '../rating-groups'
import type { StudyMode } from '../../types/database'

const ALL_STUDY_MODES: StudyMode[] = ['srs', 'sequential_review', 'random', 'sequential', 'by_date', 'cramming']

describe('RATING_GROUP_REGISTRY', () => {
  it('has exactly 3 groups in order: srs, simple, cramming', () => {
    expect(RATING_GROUP_REGISTRY.map((g) => g.id)).toEqual(['srs', 'simple', 'cramming'])
  })

  it('every group has at least one rating', () => {
    for (const g of RATING_GROUP_REGISTRY) {
      expect(g.ratings.length).toBeGreaterThan(0)
    }
  })

  it('every group has at least one mode', () => {
    for (const g of RATING_GROUP_REGISTRY) {
      expect(g.modes.length).toBeGreaterThan(0)
    }
  })

  it('every rating in a group has a corresponding color', () => {
    for (const g of RATING_GROUP_REGISTRY) {
      for (const rating of g.ratings) {
        expect(g.colors[rating]).toBeDefined()
        expect(g.colors[rating]).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })

  it('no rating appears in multiple groups', () => {
    const seen = new Set<string>()
    for (const g of RATING_GROUP_REGISTRY) {
      for (const r of g.ratings) {
        expect(seen.has(r)).toBe(false)
        seen.add(r)
      }
    }
  })

  it('no mode appears in multiple groups', () => {
    const seen = new Set<string>()
    for (const g of RATING_GROUP_REGISTRY) {
      for (const m of g.modes) {
        expect(seen.has(m)).toBe(false)
        seen.add(m)
      }
    }
  })
})

describe('STUDY_MODE_TO_GROUP', () => {
  it('maps every StudyMode to a group', () => {
    for (const mode of ALL_STUDY_MODES) {
      expect(STUDY_MODE_TO_GROUP[mode]).toBeDefined()
    }
  })

  it('srs mode maps to srs group', () => {
    expect(STUDY_MODE_TO_GROUP['srs']).toBe('srs')
  })

  it('simple modes map to simple group', () => {
    expect(STUDY_MODE_TO_GROUP['random']).toBe('simple')
    expect(STUDY_MODE_TO_GROUP['sequential']).toBe('simple')
    expect(STUDY_MODE_TO_GROUP['by_date']).toBe('simple')
    expect(STUDY_MODE_TO_GROUP['sequential_review']).toBe('simple')
  })

  it('cramming mode maps to cramming group', () => {
    expect(STUDY_MODE_TO_GROUP['cramming']).toBe('cramming')
  })
})

describe('EXCLUDED_RATINGS', () => {
  it('contains "next"', () => {
    expect(EXCLUDED_RATINGS.has('next')).toBe(true)
  })

  it('does not contain any group rating', () => {
    for (const g of RATING_GROUP_REGISTRY) {
      for (const r of g.ratings) {
        expect(EXCLUDED_RATINGS.has(r)).toBe(false)
      }
    }
  })
})

describe('RATING_COLOR_MAP', () => {
  it('has a color for every rating across all groups', () => {
    for (const g of RATING_GROUP_REGISTRY) {
      for (const r of g.ratings) {
        expect(RATING_COLOR_MAP[r]).toBeDefined()
        expect(RATING_COLOR_MAP[r]).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })
})
