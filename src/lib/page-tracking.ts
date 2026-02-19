const EXCLUDED_PREFIXES = ['/admin', '/auth']

/**
 * Normalize a page path: remove trailing slash, query params, hash.
 */
export function normalizePagePath(path: string): string {
  if (!path) return '/'

  // Remove query string and hash
  let normalized = path.split('?')[0].split('#')[0]

  // Remove double slashes
  normalized = normalized.replace(/\/\/+/g, '/')

  // Remove trailing slash (but keep root /)
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }

  return normalized || '/'
}

/**
 * Determine if a page should be tracked.
 * Excludes admin and auth pages.
 */
export function shouldTrackPage(path: string): boolean {
  const normalized = normalizePagePath(path)
  return !EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}
