export interface UtmParams {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
}

const UTM_KEYS: (keyof UtmParams)[] = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
]

const MAX_LENGTH = 200

// source and medium are normalized to lowercase for consistent analytics grouping
const LOWERCASE_KEYS = new Set<keyof UtmParams>(['utm_source', 'utm_medium'])

/**
 * Extract UTM parameters from a URL search string.
 * Trims whitespace and lowercases source/medium for consistent grouping.
 */
export function parseUtmParams(search: string): UtmParams {
  const params = new URLSearchParams(search)
  const result: UtmParams = {}

  for (const key of UTM_KEYS) {
    const raw = params.get(key)
    if (raw == null) continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    const normalized = LOWERCASE_KEYS.has(key) ? trimmed.toLowerCase() : trimmed
    result[key] = normalized.slice(0, MAX_LENGTH)
  }

  return result
}
