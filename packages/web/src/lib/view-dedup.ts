export interface ViewDedupTracker {
  hasViewed(contentId: string): boolean
  markViewed(contentId: string, viewId: string): void
  getExistingViewId(contentId: string): string | undefined
  clearView(contentId: string): void
}

/**
 * Creates a dedup tracker for content views within the same page lifecycle.
 * Prevents duplicate RPC calls on refresh/re-render for the same content.
 */
export function createViewDedupTracker(store?: Map<string, string>): ViewDedupTracker {
  const map = store ?? new Map<string, string>()

  return {
    hasViewed(contentId: string): boolean {
      return map.has(contentId)
    },
    markViewed(contentId: string, viewId: string): void {
      map.set(contentId, viewId)
    },
    getExistingViewId(contentId: string): string | undefined {
      return map.get(contentId)
    },
    clearView(contentId: string): void {
      map.delete(contentId)
    },
  }
}
