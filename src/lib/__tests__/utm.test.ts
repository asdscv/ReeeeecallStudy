import { describe, it, expect } from 'vitest'
import { parseUtmParams } from '../utm'

describe('parseUtmParams', () => {
  it('extracts all 5 UTM parameters', () => {
    const search = '?utm_source=google&utm_medium=cpc&utm_campaign=spring&utm_term=cards&utm_content=banner'
    const result = parseUtmParams(search)
    expect(result).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'spring',
      utm_term: 'cards',
      utm_content: 'banner',
    })
  })

  it('returns undefined for missing parameters', () => {
    const result = parseUtmParams('?utm_source=google')
    expect(result.utm_source).toBe('google')
    expect(result.utm_medium).toBeUndefined()
    expect(result.utm_campaign).toBeUndefined()
    expect(result.utm_term).toBeUndefined()
    expect(result.utm_content).toBeUndefined()
  })

  it('handles URL-encoded values', () => {
    const search = '?utm_source=hello%20world&utm_campaign=%ED%95%9C%EA%B8%80'
    const result = parseUtmParams(search)
    expect(result.utm_source).toBe('hello world')
    expect(result.utm_campaign).toBe('한글')
  })

  it('returns all undefined for empty string', () => {
    const result = parseUtmParams('')
    expect(result.utm_source).toBeUndefined()
    expect(result.utm_medium).toBeUndefined()
  })

  it('ignores empty string values', () => {
    const result = parseUtmParams('?utm_source=&utm_medium=email')
    expect(result.utm_source).toBeUndefined()
    expect(result.utm_medium).toBe('email')
  })

  it('truncates values at 200 characters', () => {
    const longValue = 'a'.repeat(250)
    const result = parseUtmParams(`?utm_source=${longValue}`)
    expect(result.utm_source).toHaveLength(200)
  })

  it('handles search string without question mark', () => {
    const result = parseUtmParams('utm_source=direct')
    expect(result.utm_source).toBe('direct')
  })
})
