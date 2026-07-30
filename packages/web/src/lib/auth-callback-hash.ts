// Module-level hash capture — executes synchronously on module load, before Supabase's
// async processing can strip the URL hash via replaceState. An email link click is a full
// page load, so this module is freshly imported at exactly the right moment.
//
// It lives outside AuthCallback.tsx so that component file exports only a component
// (fast refresh) and so the test seam is not an export on a UI module.
let capturedHash = typeof window === 'undefined' ? '' : window.location.hash

export function capturedAuthHash(): string {
  return capturedHash
}

/** Override the captured hash — for tests only. */
export function _setCapturedHash(hash: string) {
  capturedHash = hash
}
