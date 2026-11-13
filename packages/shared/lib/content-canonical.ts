/** Normalize the legacy generated (English-only) canonical without losing editorial overrides. */
export function contentCanonicalUrl(siteUrl: string, slug: string, locale: string, customCanonical?: string | null): string {
  const base = `${siteUrl}/insight/${slug}`
  if (customCanonical && customCanonical !== base && customCanonical !== `${base}?lang=en`) return customCanonical
  return `${base}${locale !== 'en' ? `?lang=${locale}` : ''}`
}
