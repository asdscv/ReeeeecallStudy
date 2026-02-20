import { describe, it, expect } from 'vitest'
import {
  SUPPORTED_LOCALES,
  resolveLocale,
  toIntlLocale,
  toContentLocale,
  isSupportedLocale,
} from '../locale-utils'

describe('SUPPORTED_LOCALES', () => {
  it('contains en, ko, zh, ja', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'ko', 'zh', 'ja'])
  })
})

describe('resolveLocale', () => {
  it('returns en for undefined', () => {
    expect(resolveLocale(undefined)).toBe('en')
  })

  it('returns en for empty string', () => {
    expect(resolveLocale('')).toBe('en')
  })

  it('returns ko for "ko"', () => {
    expect(resolveLocale('ko')).toBe('ko')
  })

  it('returns ko for "ko-KR"', () => {
    expect(resolveLocale('ko-KR')).toBe('ko')
  })

  it('returns zh for "zh"', () => {
    expect(resolveLocale('zh')).toBe('zh')
  })

  it('returns zh for "zh-CN"', () => {
    expect(resolveLocale('zh-CN')).toBe('zh')
  })

  it('returns zh for "zh-Hans-CN"', () => {
    expect(resolveLocale('zh-Hans-CN')).toBe('zh')
  })

  it('returns ja for "ja"', () => {
    expect(resolveLocale('ja')).toBe('ja')
  })

  it('returns ja for "ja-JP"', () => {
    expect(resolveLocale('ja-JP')).toBe('ja')
  })

  it('returns en for unsupported locale "fr"', () => {
    expect(resolveLocale('fr')).toBe('en')
  })

  it('returns en for "en-US"', () => {
    expect(resolveLocale('en-US')).toBe('en')
  })
})

describe('toIntlLocale', () => {
  it('maps en → en-US', () => {
    expect(toIntlLocale('en')).toBe('en-US')
  })

  it('maps ko → ko-KR', () => {
    expect(toIntlLocale('ko')).toBe('ko-KR')
  })

  it('maps zh → zh-CN', () => {
    expect(toIntlLocale('zh')).toBe('zh-CN')
  })

  it('maps ja → ja-JP', () => {
    expect(toIntlLocale('ja')).toBe('ja-JP')
  })

  it('maps ko-KR → ko-KR (resolves then maps)', () => {
    expect(toIntlLocale('ko-KR')).toBe('ko-KR')
  })

  it('maps undefined → en-US', () => {
    expect(toIntlLocale(undefined)).toBe('en-US')
  })

  it('maps unknown → en-US', () => {
    expect(toIntlLocale('fr')).toBe('en-US')
  })
})

describe('toContentLocale', () => {
  it('maps ko-KR → ko', () => {
    expect(toContentLocale('ko-KR')).toBe('ko')
  })

  it('maps zh-Hans → zh', () => {
    expect(toContentLocale('zh-Hans')).toBe('zh')
  })

  it('maps ja-JP → ja', () => {
    expect(toContentLocale('ja-JP')).toBe('ja')
  })

  it('maps en → en', () => {
    expect(toContentLocale('en')).toBe('en')
  })

  it('maps undefined → en', () => {
    expect(toContentLocale(undefined)).toBe('en')
  })

  it('maps unknown → en', () => {
    expect(toContentLocale('fr')).toBe('en')
  })
})

describe('isSupportedLocale', () => {
  it('returns true for en', () => {
    expect(isSupportedLocale('en')).toBe(true)
  })

  it('returns true for ko', () => {
    expect(isSupportedLocale('ko')).toBe(true)
  })

  it('returns true for zh', () => {
    expect(isSupportedLocale('zh')).toBe(true)
  })

  it('returns true for ja', () => {
    expect(isSupportedLocale('ja')).toBe(true)
  })

  it('returns false for fr', () => {
    expect(isSupportedLocale('fr')).toBe(false)
  })

  it('returns false for en-US (not base locale)', () => {
    expect(isSupportedLocale('en-US')).toBe(false)
  })
})
