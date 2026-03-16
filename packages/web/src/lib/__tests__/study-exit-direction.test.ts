import { describe, it, expect } from 'vitest'
import { getRatingExitDirection } from '../study-exit-direction'

describe('getRatingExitDirection', () => {
  it.each(['again', 'hard', 'missed', 'unknown'] as const)(
    '%s → left',
    (rating) => {
      expect(getRatingExitDirection(rating)).toBe('left')
    },
  )

  it.each(['good', 'easy', 'got_it', 'known', 'next'] as const)(
    '%s → right',
    (rating) => {
      expect(getRatingExitDirection(rating)).toBe('right')
    },
  )
})
