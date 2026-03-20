import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { announceToScreenReader, trapFocus, generateAriaId, prefersReducedMotion } from '../a11y'

describe('a11y utilities', () => {
  describe('announceToScreenReader', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('creates an aria-live element with the message', () => {
      announceToScreenReader('Test message')

      const liveRegion = document.querySelector('[aria-live="polite"]')
      expect(liveRegion).toBeTruthy()
      expect(liveRegion?.getAttribute('role')).toBe('status')
      expect(liveRegion?.getAttribute('aria-atomic')).toBe('true')
    })

    it('uses assertive priority when specified', () => {
      announceToScreenReader('Urgent message', 'assertive')

      const liveRegion = document.querySelector('[aria-live="assertive"]')
      expect(liveRegion).toBeTruthy()
    })

    it('element is added to the DOM', () => {
      announceToScreenReader('Temporary message')
      const el = document.querySelector('[aria-live="polite"]')
      expect(el).toBeTruthy()
      // cleanup
      el?.remove()
    })
  })

  describe('trapFocus', () => {
    it('returns a cleanup function', () => {
      const container = document.createElement('div')
      const button = document.createElement('button')
      container.appendChild(button)
      document.body.appendChild(container)

      const cleanup = trapFocus(container)
      expect(typeof cleanup).toBe('function')

      cleanup()
      document.body.removeChild(container)
    })

    it('focuses first focusable element on mount', () => {
      const container = document.createElement('div')
      const btn1 = document.createElement('button')
      btn1.textContent = 'First'
      const btn2 = document.createElement('button')
      btn2.textContent = 'Second'
      container.appendChild(btn1)
      container.appendChild(btn2)
      document.body.appendChild(container)

      trapFocus(container)
      expect(document.activeElement).toBe(btn1)

      document.body.removeChild(container)
    })
  })

  describe('generateAriaId', () => {
    it('generates unique IDs', () => {
      const id1 = generateAriaId()
      const id2 = generateAriaId()
      expect(id1).not.toBe(id2)
    })

    it('uses custom prefix', () => {
      const id = generateAriaId('modal')
      expect(id).toMatch(/^modal-\d+$/)
    })
  })

  describe('prefersReducedMotion', () => {
    it('returns a boolean', () => {
      const result = prefersReducedMotion()
      expect(typeof result).toBe('boolean')
    })
  })
})
