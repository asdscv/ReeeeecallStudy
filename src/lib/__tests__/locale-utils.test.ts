import { describe, it, expect } from 'vitest'
import {
  LOCALE_CONFIG,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  INTL_LOCALE_MAP,
  OG_LOCALE_MAP,
  LOCALE_LABELS,
  LOCALE_TO_LANGUAGE,
  resolveLocale,
  toIntlLocale,
  toContentLocale,
  toOgLocale,
  isSupportedLocale,
} from '../locale-utils'

describe('LOCALE_CONFIG', () => {
  it('has all SUPPORTED_LOCALES as keys', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_CONFIG).toHaveProperty(locale)
    }
  })

  it('each entry has intl, og, label, language, color fields', () => {
    for (const key of Object.keys(LOCALE_CONFIG)) {
      const entry = LOCALE_CONFIG[key as keyof typeof LOCALE_CONFIG]
      expect(entry).toHaveProperty('intl')
      expect(entry).toHaveProperty('og')
      expect(entry).toHaveProperty('label')
      expect(entry).toHaveProperty('language')
      expect(entry).toHaveProperty('color')
    }
  })
})

describe('SUPPORTED_LOCALES', () => {
  it('contains all locales from LOCALE_CONFIG', () => {
    for (const locale of Object.keys(LOCALE_CONFIG)) {
      expect(SUPPORTED_LOCALES).toContain(locale)
    }
  })

  it('has length matching LOCALE_CONFIG keys', () => {
    expect(SUPPORTED_LOCALES.length).toBe(Object.keys(LOCALE_CONFIG).length)
  })
})

describe('DEFAULT_LOCALE', () => {
  it('is a valid supported locale', () => {
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE)
  })
})

describe('derived maps', () => {
  it.each(SUPPORTED_LOCALES)('INTL_LOCALE_MAP has entry for %s matching LOCALE_CONFIG', (locale) => {
    expect(INTL_LOCALE_MAP[locale]).toBe(LOCALE_CONFIG[locale].intl)
  })

  it.each(SUPPORTED_LOCALES)('OG_LOCALE_MAP has entry for %s matching LOCALE_CONFIG', (locale) => {
    expect(OG_LOCALE_MAP[locale]).toBe(LOCALE_CONFIG[locale].og)
  })

  it.each(SUPPORTED_LOCALES)('LOCALE_LABELS has entry for %s matching LOCALE_CONFIG', (locale) => {
    expect(LOCALE_LABELS[locale]).toBe(LOCALE_CONFIG[locale].label)
  })

  it.each(SUPPORTED_LOCALES)('LOCALE_TO_LANGUAGE has entry for %s matching LOCALE_CONFIG', (locale) => {
    expect(LOCALE_TO_LANGUAGE[locale]).toBe(LOCALE_CONFIG[locale].language)
  })

  it('all maps have the same keys as SUPPORTED_LOCALES', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(INTL_LOCALE_MAP).toHaveProperty(locale)
      expect(OG_LOCALE_MAP).toHaveProperty(locale)
      expect(LOCALE_LABELS).toHaveProperty(locale)
      expect(LOCALE_TO_LANGUAGE).toHaveProperty(locale)
    }
  })
})

describe('resolveLocale', () => {
  it('returns DEFAULT_LOCALE for undefined', () => {
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE)
  })

  it('returns DEFAULT_LOCALE for empty string', () => {
    expect(resolveLocale('')).toBe(DEFAULT_LOCALE)
  })

  it.each(SUPPORTED_LOCALES)('returns %s for "%s"', (locale) => {
    expect(resolveLocale(locale)).toBe(locale)
  })

  it.each(SUPPORTED_LOCALES)('returns %s for Intl variant "%s"', (locale) => {
    const intlVariant = LOCALE_CONFIG[locale].intl // e.g. 'ko-KR'
    expect(resolveLocale(intlVariant)).toBe(locale)
  })

  it('returns DEFAULT_LOCALE for unsupported locale "fr"', () => {
    expect(resolveLocale('fr')).toBe(DEFAULT_LOCALE)
  })
})

describe('toIntlLocale', () => {
  it.each(SUPPORTED_LOCALES)('maps %s → LOCALE_CONFIG intl', (locale) => {
    expect(toIntlLocale(locale)).toBe(LOCALE_CONFIG[locale].intl)
  })

  it('maps undefined → DEFAULT_LOCALE intl', () => {
    expect(toIntlLocale(undefined)).toBe(LOCALE_CONFIG[DEFAULT_LOCALE].intl)
  })

  it('maps unknown → DEFAULT_LOCALE intl', () => {
    expect(toIntlLocale('fr')).toBe(LOCALE_CONFIG[DEFAULT_LOCALE].intl)
  })
})

describe('toOgLocale', () => {
  it.each(SUPPORTED_LOCALES)('maps %s → LOCALE_CONFIG og', (locale) => {
    expect(toOgLocale(locale)).toBe(LOCALE_CONFIG[locale].og)
  })

  it('falls back to lang_LANG pattern for unknown', () => {
    expect(toOgLocale('fr')).toBe('fr_FR')
  })
})

describe('toContentLocale', () => {
  it.each(SUPPORTED_LOCALES)('maps Intl variant of %s back to %s', (locale) => {
    const intlVariant = LOCALE_CONFIG[locale].intl
    expect(toContentLocale(intlVariant)).toBe(locale)
  })

  it.each(SUPPORTED_LOCALES)('maps %s → %s (identity)', (locale) => {
    expect(toContentLocale(locale)).toBe(locale)
  })

  it('maps undefined → DEFAULT_LOCALE', () => {
    expect(toContentLocale(undefined)).toBe(DEFAULT_LOCALE)
  })

  it('maps unknown → DEFAULT_LOCALE', () => {
    expect(toContentLocale('fr')).toBe(DEFAULT_LOCALE)
  })
})

describe('isSupportedLocale', () => {
  it.each(SUPPORTED_LOCALES)('returns true for %s', (locale) => {
    expect(isSupportedLocale(locale)).toBe(true)
  })

  it('returns false for fr', () => {
    expect(isSupportedLocale('fr')).toBe(false)
  })

  it('returns false for Intl variant (not base locale)', () => {
    const intlVariant = LOCALE_CONFIG[DEFAULT_LOCALE].intl
    expect(isSupportedLocale(intlVariant)).toBe(false)
  })
})
