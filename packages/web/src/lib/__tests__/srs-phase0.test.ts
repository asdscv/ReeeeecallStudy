/**
 * SRS Phase 0 Tests — Academic Research-Based Improvements
 *
 * Tests for:
 * 0.1 Good rating ease recovery (+0.05) — prevents Ease Hell
 * 0.2 Mean Reversion — extreme ease values trend toward 2.5
 * 0.3 Interval Growth Cap — max 3x per review (diminishing returns)
 * 0.5 Overdue Bonus — late reviews get interval bonus (Spacing Effect)
 *
 * References:
 * - Wozniak (1990) SM-2: Ease Hell problem
 * - Ye (2024) FSRS-5: Mean Reversion via D' = w7*D0(4) + (1-w7)*D
 * - Wickelgren (1974): Power Law of Forgetting → diminishing returns
 * - Bjork (1994): Spacing Effect → overdue bonus
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('i18next', () => ({
  default: { t: (key: string, opts?: Record<string, unknown>) => opts?.count !== undefined ? `${key}:${opts.count}` : key },
}))

import { calculateSRS } from '../srs'
import type { SrsCardData } from '../srs'
import { DEFAULT_SRS_SETTINGS } from '../../types/database'

const settings = { ...DEFAULT_SRS_SETTINGS }

function reviewCard(ease: number, interval: number, reps: number): SrsCardData {
  return { srs_status: 'review', ease_factor: ease, interval_days: interval, repetitions: reps }
}

describe('Phase 0: Ease Hell Prevention', () => {
  describe('0.1 Good rating should increase ease slightly', () => {
    it('good on review card with ease 2.5 should increase ease', () => {
      const card = reviewCard(2.5, 10, 3)
      const result = calculateSRS(card, 'good', settings)
      // Ease should increase slightly (not stay flat)
      expect(result.ease_factor).toBeGreaterThan(2.5)
    })

    it('good on review card with ease 1.3 (Ease Hell) should start recovery', () => {
      const card = reviewCard(1.3, 5, 3)
      const result = calculateSRS(card, 'good', settings)
      // Must be above 1.3 — recovery from Ease Hell
      expect(result.ease_factor).toBeGreaterThan(1.3)
    })

    it('10 consecutive good ratings on ease 1.3 should recover significantly', () => {
      let ease = 1.3
      for (let i = 0; i < 10; i++) {
        const card = reviewCard(ease, 10, 3)
        const result = calculateSRS(card, 'good', settings)
        ease = result.ease_factor
      }
      // After 10 goods, should be notably above 1.3
      expect(ease).toBeGreaterThan(1.8)
    })
  })

  describe('0.2 Mean Reversion', () => {
    it('very low ease (1.3) should trend up toward 2.5', () => {
      const card = reviewCard(1.3, 5, 3)
      const result = calculateSRS(card, 'good', settings)
      // Mean reversion pushes low ease up
      expect(result.ease_factor).toBeGreaterThan(1.3)
    })

    it('very high ease (4.0) should trend down slightly on good', () => {
      const card = reviewCard(4.0, 30, 5)
      const result = calculateSRS(card, 'good', settings)
      // Mean reversion pulls high ease slightly down
      expect(result.ease_factor).toBeLessThanOrEqual(4.0)
    })

    it('ease near 2.5 should stay relatively stable on good', () => {
      const card = reviewCard(2.5, 10, 3)
      const result = calculateSRS(card, 'good', settings)
      // Should be close to 2.5 (mean reversion is small here)
      expect(Math.abs(result.ease_factor - 2.5)).toBeLessThan(0.2)
    })
  })

  describe('0.3 Interval Growth Cap (Diminishing Returns)', () => {
    it('interval should not grow more than 3x in one review', () => {
      const card = reviewCard(2.5, 100, 5)
      const result = calculateSRS(card, 'good', settings)
      // Max 3x growth: 100 → max 300
      expect(result.interval_days).toBeLessThanOrEqual(300)
    })

    it('easy rating should also be capped at reasonable growth', () => {
      const card = reviewCard(3.0, 100, 5)
      const result = calculateSRS(card, 'easy', settings)
      // Even easy should not exceed reasonable cap
      expect(result.interval_days).toBeLessThanOrEqual(365) // max interval cap
    })

    it('small intervals should still grow normally', () => {
      const card = reviewCard(2.5, 3, 2)
      const result = calculateSRS(card, 'good', settings)
      // Small intervals: 3 × 2.5 = 7.5 → ~8 (within 3x cap of 9)
      expect(result.interval_days).toBeGreaterThan(3)
      expect(result.interval_days).toBeLessThanOrEqual(9)
    })
  })

  describe('0.5 Overdue Bonus (Spacing Effect)', () => {
    it('card reviewed on time should get normal interval', () => {
      const card = reviewCard(2.5, 10, 3)
      const result = calculateSRS(card, 'good', settings)
      const normalInterval = result.interval_days

      // Normal case — no overdue bonus
      expect(normalInterval).toBeGreaterThan(10)
    })
  })

  describe('Interval ordering guarantee preserved', () => {
    it('again < hard < good < easy for review cards', () => {
      const card = reviewCard(2.5, 10, 3)
      const again = calculateSRS(card, 'again', settings)
      const hard = calculateSRS(card, 'hard', settings)
      const good = calculateSRS(card, 'good', settings)
      const easy = calculateSRS(card, 'easy', settings)

      // again returns to learning (interval 0), others are review
      expect(again.interval_days).toBeLessThanOrEqual(hard.interval_days)
      expect(hard.interval_days).toBeLessThan(good.interval_days)
      expect(good.interval_days).toBeLessThan(easy.interval_days)
    })

    it('easy uses UPDATED ease (not old card.ease_factor) for goodIvl calc', () => {
      // Regression test: easy case was using card.ease_factor (pre-update)
      // instead of ease (post-update) for the goodIvl intermediate calculation
      const card = reviewCard(2.0, 30, 5) // low ease card
      const good = calculateSRS(card, 'good', settings)
      const easy = calculateSRS(card, 'easy', settings)

      // easy must always produce longer interval than good for same card
      expect(easy.interval_days).toBeGreaterThan(good.interval_days)
    })

    it('ordering preserved when both good and easy hit growth cap', () => {
      // High ease + large interval → both could hit 3× cap
      const card = reviewCard(3.5, 100, 5)
      const good = calculateSRS(card, 'good', settings)
      const easy = calculateSRS(card, 'easy', settings)

      // easy must STRICTLY exceed good even when both hit cap
      expect(easy.interval_days).toBeGreaterThan(good.interval_days)
    })

    it('ordering holds for extreme ease values', () => {
      // Test with very low ease (Ease Hell recovery scenario)
      const card = reviewCard(1.3, 20, 4)
      const hard = calculateSRS(card, 'hard', settings)
      const good = calculateSRS(card, 'good', settings)
      const easy = calculateSRS(card, 'easy', settings)

      expect(hard.interval_days).toBeLessThan(good.interval_days)
      expect(good.interval_days).toBeLessThan(easy.interval_days)
    })
  })

  describe('Ease factor bounds always respected', () => {
    it('ease never goes below 1.3', () => {
      const card = reviewCard(1.3, 5, 3)
      const result = calculateSRS(card, 'again', settings)
      expect(result.ease_factor).toBeGreaterThanOrEqual(1.3)
    })

    it('ease never goes above 4.0', () => {
      const card = reviewCard(4.0, 30, 5)
      const result = calculateSRS(card, 'easy', settings)
      expect(result.ease_factor).toBeLessThanOrEqual(4.0)
    })
  })
})
