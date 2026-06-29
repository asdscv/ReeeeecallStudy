import { describe, it, expect } from 'vitest'
import {
  LOCALE_REGISTRY, DEFAULT_LOCALE,
  ALL_LOCALES, GENERATED_LOCALES, INDEXABLE_LOCALES, UI_LOCALES,
  isGenerated, isIndexable, isUiLocale,
} from '../locale-policy.js'

describe('locale-policy (single source of truth)', () => {
  it('generates and indexes only en + ko under the current policy', () => {
    expect(GENERATED_LOCALES).toEqual(['en', 'ko'])
    expect(INDEXABLE_LOCALES).toEqual(['en', 'ko'])
  })

  it('still SERVES all 8 locales to users (ui) — reach is preserved', () => {
    expect(UI_LOCALES).toEqual(['en', 'ko', 'zh', 'ja', 'vi', 'th', 'id', 'es'])
    expect(ALL_LOCALES).toHaveLength(8)
  })

  it('predicates reflect the registry flags independently', () => {
    expect(isGenerated('en')).toBe(true)
    expect(isGenerated('ja')).toBe(false)
    expect(isIndexable('ko')).toBe(true)
    expect(isIndexable('th')).toBe(false)
    // es: served to users but NOT indexed — the whole point of the policy
    expect(isUiLocale('es')).toBe(true)
    expect(isIndexable('es')).toBe(false)
  })

  it('unknown locale is false everywhere and never throws', () => {
    expect(isGenerated('xx')).toBe(false)
    expect(isIndexable('xx')).toBe(false)
    expect(isUiLocale('xx')).toBe(false)
  })

  it('default locale satisfies the generate+index invariant', () => {
    expect(isGenerated(DEFAULT_LOCALE)).toBe(true)
    expect(isIndexable(DEFAULT_LOCALE)).toBe(true)
  })

  it('derived views are honestly derived from the registry (re-expansion safe)', () => {
    for (const l of GENERATED_LOCALES) expect(LOCALE_REGISTRY[l].generate).toBe(true)
    for (const l of INDEXABLE_LOCALES) expect(LOCALE_REGISTRY[l].index).toBe(true)
    for (const l of UI_LOCALES) expect(LOCALE_REGISTRY[l].ui).toBe(true)
  })
})
