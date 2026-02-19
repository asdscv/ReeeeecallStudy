// Enterprise UTM parameter builder for content pipeline
// Ensures all auto-generated content links have consistent, trackable UTM params

export const UTM_DEFAULTS = {
  source: 'blog',
  medium_cta: 'cta',
  medium_link: 'content_link',
}

/**
 * Build a CTA URL with enterprise UTM parameters.
 *
 * @param {string} baseUrl - Base URL path (e.g. "/auth/login")
 * @param {string} slug - Article slug used as utm_campaign
 * @param {string} locale - Locale code ("en" | "ko")
 * @param {string} [blockType="cta"] - Block type for utm_content
 * @returns {string} URL with UTM query params appended
 */
export function buildCtaUrl(baseUrl, slug, locale, blockType = 'cta') {
  const base = baseUrl || '/auth/login'
  const [path, existingQuery] = base.split('?')
  const params = new URLSearchParams(existingQuery || '')

  params.set('utm_source', UTM_DEFAULTS.source)
  params.set('utm_medium', UTM_DEFAULTS.medium_cta)
  params.set('utm_campaign', (slug || '').slice(0, 200))
  params.set('utm_content', `${blockType}_${locale}`)

  return `${path}?${params.toString()}`
}

/**
 * Build an internal link URL with UTM parameters (for inline content links).
 *
 * @param {string} baseUrl - Target URL path
 * @param {string} slug - Article slug used as utm_campaign
 * @param {string} locale - Locale code
 * @param {string} [label="link"] - Label prefix for utm_content
 * @returns {string} URL with UTM query params appended
 */
export function buildInternalUrl(baseUrl, slug, locale, label = 'link') {
  const [path, existingQuery] = baseUrl.split('?')
  const params = new URLSearchParams(existingQuery || '')

  params.set('utm_source', UTM_DEFAULTS.source)
  params.set('utm_medium', UTM_DEFAULTS.medium_link)
  params.set('utm_campaign', (slug || '').slice(0, 200))
  params.set('utm_content', `${label}_${locale}`)

  return `${path}?${params.toString()}`
}
