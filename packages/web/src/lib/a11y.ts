/**
 * Accessibility utilities
 *
 * Provides helpers for screen readers, focus management, and keyboard navigation.
 */

/**
 * Announce a message to screen readers via an ARIA live region.
 * Creates a temporary element, inserts the text, and removes it after announcement.
 */
export function announceToScreenReader(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
  const el = document.createElement('div')
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', priority)
  el.setAttribute('aria-atomic', 'true')
  el.className = 'sr-only'
  el.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0'
  document.body.appendChild(el)

  // Delay to ensure screen readers pick up the change
  requestAnimationFrame(() => {
    el.textContent = message
    setTimeout(() => {
      document.body.removeChild(el)
    }, 1000)
  })
}

/**
 * Trap focus within a container element (for modals, dialogs).
 * Returns a cleanup function to restore focus.
 */
export function trapFocus(container: HTMLElement): () => void {
  const previouslyFocused = document.activeElement as HTMLElement | null
  const focusableSelector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return

    const focusable = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  container.addEventListener('keydown', handleKeydown)

  // Focus first focusable element
  const firstFocusable = container.querySelector<HTMLElement>(focusableSelector)
  firstFocusable?.focus()

  return () => {
    container.removeEventListener('keydown', handleKeydown)
    previouslyFocused?.focus()
  }
}

/**
 * Generate a unique ID for ARIA relationships (labelledby, describedby).
 */
let counter = 0
export function generateAriaId(prefix = 'aria'): string {
  return `${prefix}-${++counter}`
}

/**
 * Check if user prefers reduced motion.
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
