import { describe, it, expect } from 'vitest'
import { resolveKeyAction } from '../keyboard-actions'

describe('resolveKeyAction', () => {
  // ─── Global ───────────────────────────────────────────
  it('Escape always exits regardless of flip state', () => {
    expect(resolveKeyAction('Escape', false, 'srs')).toEqual({ type: 'exit' })
    expect(resolveKeyAction('Escape', true, 'random')).toEqual({ type: 'exit' })
  })

  // ─── Front side (not flipped) ─────────────────────────
  describe('front side (not flipped)', () => {
    it('Space flips the card', () => {
      expect(resolveKeyAction(' ', false, 'srs')).toEqual({ type: 'flip' })
    })

    it('Enter flips the card', () => {
      expect(resolveKeyAction('Enter', false, 'sequential')).toEqual({ type: 'flip' })
    })

    it('number keys do nothing on front side', () => {
      expect(resolveKeyAction('1', false, 'srs')).toBeNull()
      expect(resolveKeyAction('4', false, 'srs')).toBeNull()
    })

    it('arrow keys do nothing on front side', () => {
      expect(resolveKeyAction('ArrowRight', false, 'random')).toBeNull()
      expect(resolveKeyAction('ArrowLeft', false, 'sequential_review')).toBeNull()
    })
  })

  // ─── SRS mode (back side) ────────────────────────────
  describe('SRS mode (flipped)', () => {
    it('1 → again', () => {
      expect(resolveKeyAction('1', true, 'srs')).toEqual({ type: 'rate', rating: 'again' })
    })

    it('2 → hard', () => {
      expect(resolveKeyAction('2', true, 'srs')).toEqual({ type: 'rate', rating: 'hard' })
    })

    it('3 → good', () => {
      expect(resolveKeyAction('3', true, 'srs')).toEqual({ type: 'rate', rating: 'good' })
    })

    it('4 → easy', () => {
      expect(resolveKeyAction('4', true, 'srs')).toEqual({ type: 'rate', rating: 'easy' })
    })

    it('5 does nothing (out of range)', () => {
      expect(resolveKeyAction('5', true, 'srs')).toBeNull()
    })

    it('ArrowRight does nothing in SRS mode', () => {
      expect(resolveKeyAction('ArrowRight', true, 'srs')).toBeNull()
    })
  })

  // ─── sequential_review mode (back side) ──────────────
  describe('sequential_review mode (flipped)', () => {
    it('ArrowRight → known', () => {
      expect(resolveKeyAction('ArrowRight', true, 'sequential_review')).toEqual({
        type: 'rate',
        rating: 'known',
      })
    })

    it('Space → known', () => {
      expect(resolveKeyAction(' ', true, 'sequential_review')).toEqual({
        type: 'rate',
        rating: 'known',
      })
    })

    it('ArrowLeft → unknown', () => {
      // THIS IS THE BUG FIX: ArrowLeft should trigger 'unknown' rating
      expect(resolveKeyAction('ArrowLeft', true, 'sequential_review')).toEqual({
        type: 'rate',
        rating: 'unknown',
      })
    })

    it('number keys do nothing in sequential_review', () => {
      expect(resolveKeyAction('1', true, 'sequential_review')).toBeNull()
    })
  })

  // ─── Other non-SRS modes (random, sequential, by_date) ─
  describe.each(['random', 'sequential', 'by_date'] as const)('%s mode (flipped)', (mode) => {
    it('ArrowRight → known', () => {
      expect(resolveKeyAction('ArrowRight', true, mode)).toEqual({
        type: 'rate',
        rating: 'known',
      })
    })

    it('Space → known', () => {
      expect(resolveKeyAction(' ', true, mode)).toEqual({
        type: 'rate',
        rating: 'known',
      })
    })

    it('ArrowLeft → unknown', () => {
      expect(resolveKeyAction('ArrowLeft', true, mode)).toEqual({
        type: 'rate',
        rating: 'unknown',
      })
    })
  })
})
