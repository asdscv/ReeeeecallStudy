import { describe, it, expect } from 'vitest'
import { SEO, toOgLocale } from '../seo-config'
import { SUPPORTED_LOCALES, OG_LOCALE_MAP } from '../locale-utils'

describe('SEO config', () => {
  it('should export SITE_URL as absolute HTTPS URL', () => {
    expect(SEO.SITE_URL).toMatch(/^https:\/\//)
  })

  it('should export BRAND_NAME', () => {
    expect(SEO.BRAND_NAME).toBe('ReeeeecallStudy')
  })

  it('should export TWITTER_HANDLE starting with @', () => {
    expect(SEO.TWITTER_HANDLE).toMatch(/^@/)
  })

  it('should export DEFAULT_OG_IMAGE as absolute URL', () => {
    expect(SEO.DEFAULT_OG_IMAGE).toMatch(/^https:\/\//)
  })

  it('should export OG_IMAGE dimensions at recommended 1200x630', () => {
    expect(SEO.OG_IMAGE_WIDTH).toBe(1200)
    expect(SEO.OG_IMAGE_HEIGHT).toBe(630)
  })

  it('should export SUPPORTED_LOCALES with all locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(SEO.SUPPORTED_LOCALES).toContain(locale)
    }
  })

  it('should export SUPPORTED_LOCALES with vi, th, id', () => {
    expect(SEO.SUPPORTED_LOCALES).toContain('vi')
    expect(SEO.SUPPORTED_LOCALES).toContain('th')
    expect(SEO.SUPPORTED_LOCALES).toContain('id')
  })
})

describe('toOgLocale', () => {
  it.each(SUPPORTED_LOCALES)('maps %s to OG_LOCALE_MAP value', (locale) => {
    expect(toOgLocale(locale)).toBe(OG_LOCALE_MAP[locale])
  })

  it('maps vi to vi_VN', () => {
    expect(toOgLocale('vi')).toBe('vi_VN')
  })

  it('maps th to th_TH', () => {
    expect(toOgLocale('th')).toBe('th_TH')
  })

  it('maps id to id_ID', () => {
    expect(toOgLocale('id')).toBe('id_ID')
  })

  it('provides a sensible fallback for unknown locales', () => {
    expect(toOgLocale('pt')).toBe('pt_PT')
  })
})
