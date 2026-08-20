// '/auth' 전체를 제외하면 UTM 이 한 줄도 안 남는다 — 콘텐츠 CTA 와 광고 링크가 전부
// /auth/login 으로 떨어지는데 그 경로가 추적 제외였다. page_views 14,440행의
// utm_source 가 전부 NULL 인 진짜 이유가 이것이다.
//
// 그래서 광고가 착지하는 /auth/login·/auth/signup 만 열고, 토큰이 실려 오는
// 콜백과 비밀번호 재설정은 그대로 닫아 둔다.
const EXCLUDED_PREFIXES = ['/admin', '/auth/callback', '/auth/reset-password']

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
  return !EXCLUDED_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix + '/'),
  )
}
