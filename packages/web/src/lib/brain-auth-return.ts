import { BRAIN_CONTENT_GUIDES, brainGuidePath } from '@reeeeecall/shared/lib/brain-content'

const KEY = 'reeeeecall-brain-auth-return'
const allowed = new Set(['/brain/training', ...BRAIN_CONTENT_GUIDES.map((g) => brainGuidePath(g.id))])

/** Only existing brain routes can survive an OAuth round-trip. */
export function safeBrainAuthReturn(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null
  try {
    const url = new URL(raw, 'https://auth-return.local')
    return url.origin === 'https://auth-return.local' && allowed.has(url.pathname) ? url.pathname + url.search : null
  } catch { return null }
}
export function rememberBrainAuthReturn(raw: string | null): void {
  try {
    const safe = safeBrainAuthReturn(raw)
    if (safe) sessionStorage.setItem(KEY, safe)
    else sessionStorage.removeItem(KEY)
  } catch { /* Sign-in still works when session storage is unavailable. */ }
}
export function consumeBrainAuthReturn(): string | null {
  try {
    const value = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return safeBrainAuthReturn(value)
  } catch { return null }
}
