import { describe, it, expect } from 'vitest'
import { SEO } from '../seo-config'

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

  it('should export SUPPORTED_LOCALES with en and ko', () => {
    expect(SEO.SUPPORTED_LOCALES).toContain('en')
    expect(SEO.SUPPORTED_LOCALES).toContain('ko')
  })
})
