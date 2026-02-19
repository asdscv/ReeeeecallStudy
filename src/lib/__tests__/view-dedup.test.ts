import { describe, it, expect } from 'vitest'
import { createViewDedupTracker } from '../view-dedup'

describe('createViewDedupTracker', () => {
  it('returns hasViewed false for first visit', () => {
    const tracker = createViewDedupTracker()
    expect(tracker.hasViewed('content-1')).toBe(false)
  })

  it('returns hasViewed true after markViewed', () => {
    const tracker = createViewDedupTracker()
    tracker.markViewed('content-1', 'view-id-1')
    expect(tracker.hasViewed('content-1')).toBe(true)
  })

  it('restores viewId via getExistingViewId', () => {
    const tracker = createViewDedupTracker()
    tracker.markViewed('content-1', 'view-id-1')
    expect(tracker.getExistingViewId('content-1')).toBe('view-id-1')
  })

  it('returns undefined for unvisited content', () => {
    const tracker = createViewDedupTracker()
    expect(tracker.getExistingViewId('content-1')).toBeUndefined()
  })

  it('tracks multiple contentIds independently', () => {
    const tracker = createViewDedupTracker()
    tracker.markViewed('content-1', 'view-1')
    tracker.markViewed('content-2', 'view-2')

    expect(tracker.hasViewed('content-1')).toBe(true)
    expect(tracker.hasViewed('content-2')).toBe(true)
    expect(tracker.hasViewed('content-3')).toBe(false)

    expect(tracker.getExistingViewId('content-1')).toBe('view-1')
    expect(tracker.getExistingViewId('content-2')).toBe('view-2')
  })

  it('uses provided store', () => {
    const store = new Map<string, string>()
    const tracker = createViewDedupTracker(store)
    tracker.markViewed('content-1', 'view-1')

    expect(store.get('content-1')).toBe('view-1')
  })

  it('allows clearing a specific view for re-visit tracking', () => {
    const tracker = createViewDedupTracker()
    tracker.markViewed('content-1', 'view-1')
    expect(tracker.hasViewed('content-1')).toBe(true)

    tracker.clearView('content-1')
    expect(tracker.hasViewed('content-1')).toBe(false)
    expect(tracker.getExistingViewId('content-1')).toBeUndefined()
  })

  it('clearView does nothing for unvisited content', () => {
    const tracker = createViewDedupTracker()
    tracker.clearView('content-999')
    expect(tracker.hasViewed('content-999')).toBe(false)
  })

  it('allows re-marking after clear', () => {
    const tracker = createViewDedupTracker()
    tracker.markViewed('content-1', 'view-1')
    tracker.clearView('content-1')
    tracker.markViewed('content-1', 'view-2')
    expect(tracker.getExistingViewId('content-1')).toBe('view-2')
  })
})
