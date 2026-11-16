import { currentSiteAddress } from './site-url'

/** Normalize the legacy generated (English-only) canonical without losing editorial overrides. */
export function contentCanonicalUrl(siteUrl: string, slug: string, locale: string, customCanonical?: string | null): string {
  const base = `${siteUrl}/insight/${slug}`
  const canonical = customCanonical ? currentSiteAddress(customCanonical) : null
  if (canonical && canonical !== base && canonical !== `${base}?lang=en`) return canonical
  return `${base}${locale !== 'en' ? `?lang=${locale}` : ''}`
}
