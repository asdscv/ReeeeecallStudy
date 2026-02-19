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

/**
 * Extract UTM parameters from a URL search string.
 */
export function parseUtmParams(search: string): UtmParams {
  const params = new URLSearchParams(search)
  const result: UtmParams = {}

  for (const key of UTM_KEYS) {
    const value = params.get(key)
    if (value) {
      result[key] = value.slice(0, MAX_LENGTH)
    }
  }

  return result
}
