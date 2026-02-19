import { describe, it, expect } from 'vitest'
import { categorizeReferrer, extractDomain } from '../referrer'

describe('extractDomain', () => {
  it('extracts domain from full URL', () => {
    expect(extractDomain('https://www.google.com/search?q=test')).toBe('www.google.com')
  })

  it('returns empty string for empty input', () => {
    expect(extractDomain('')).toBe('')
  })

  it('returns empty string for malformed URL', () => {
    expect(extractDomain('not-a-url')).toBe('')
  })

  it('handles URL without path', () => {
    expect(extractDomain('https://example.com')).toBe('example.com')
  })
})

describe('categorizeReferrer', () => {
  it('returns direct for empty referrer', () => {
    expect(categorizeReferrer('')).toEqual({ domain: '', category: 'direct' })
  })

  it('returns direct for undefined referrer', () => {
    expect(categorizeReferrer(undefined as unknown as string)).toEqual({ domain: '', category: 'direct' })
  })

  it('categorizes Google as search', () => {
    const result = categorizeReferrer('https://www.google.com/search?q=test')
    expect(result.category).toBe('search')
    expect(result.domain).toBe('www.google.com')
  })

  it('categorizes Bing as search', () => {
    expect(categorizeReferrer('https://www.bing.com/search?q=test').category).toBe('search')
  })

  it('categorizes Naver as search', () => {
    expect(categorizeReferrer('https://search.naver.com/search.naver?query=test').category).toBe('search')
  })

  it('categorizes Twitter as social', () => {
    expect(categorizeReferrer('https://t.co/abc123').category).toBe('social')
  })

  it('categorizes Facebook as social', () => {
    expect(categorizeReferrer('https://www.facebook.com/post/123').category).toBe('social')
  })

  it('categorizes Reddit as social', () => {
    expect(categorizeReferrer('https://www.reddit.com/r/programming').category).toBe('social')
  })

  it('categorizes same-origin as internal', () => {
    const result = categorizeReferrer('https://reeecall.com/content/some-article', 'reeecall.com')
    expect(result.category).toBe('internal')
  })

  it('categorizes unknown as other', () => {
    expect(categorizeReferrer('https://random-blog.com/article').category).toBe('other')
  })

  it('handles malformed URL gracefully', () => {
    expect(categorizeReferrer('not-a-url')).toEqual({ domain: '', category: 'direct' })
  })

  it('categorizes YouTube as social', () => {
    expect(categorizeReferrer('https://www.youtube.com/watch?v=abc').category).toBe('social')
  })

  it('categorizes LinkedIn as social', () => {
    expect(categorizeReferrer('https://www.linkedin.com/feed').category).toBe('social')
  })

  it('categorizes DuckDuckGo as search', () => {
    expect(categorizeReferrer('https://duckduckgo.com/?q=test').category).toBe('search')
  })

  it('categorizes Daum as search', () => {
    expect(categorizeReferrer('https://search.daum.net/search?q=test').category).toBe('search')
  })

  it('is case-insensitive for domain matching', () => {
    expect(categorizeReferrer('https://WWW.GOOGLE.COM/search').category).toBe('search')
    expect(categorizeReferrer('https://WWW.FACEBOOK.COM/page').category).toBe('social')
  })

  it('handles subdomain variants', () => {
    expect(categorizeReferrer('https://m.facebook.com/story').category).toBe('social')
    expect(categorizeReferrer('https://images.google.co.kr/search').category).toBe('search')
  })

  it('detects internal with subdomain match', () => {
    const result = categorizeReferrer('https://blog.reeecall.com/post', 'reeecall.com')
    expect(result.category).toBe('internal')
  })
})
