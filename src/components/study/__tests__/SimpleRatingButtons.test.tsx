import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SimpleRatingButtons } from '../SimpleRatingButtons'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'rating.unknown': 'Unknown',
        'rating.known': 'Known',
        'rating.next': 'Next →',
      }
      return map[key] ?? key
    },
  }),
}))

describe('SimpleRatingButtons', () => {
  it.each(['random', 'sequential', 'by_date', 'sequential_review'] as const)(
    '%s mode renders unknown/known buttons',
    (mode) => {
      render(<SimpleRatingButtons mode={mode} onRate={() => {}} />)
      expect(screen.getByRole('button', { name: 'Unknown' })).toBeDefined()
      expect(screen.getByRole('button', { name: 'Known' })).toBeDefined()
    },
  )

  it.each(['random', 'sequential', 'by_date'] as const)(
    '%s mode does NOT render next button',
    (mode) => {
      render(<SimpleRatingButtons mode={mode} onRate={() => {}} />)
      expect(screen.queryByRole('button', { name: 'Next →' })).toBeNull()
    },
  )
})
