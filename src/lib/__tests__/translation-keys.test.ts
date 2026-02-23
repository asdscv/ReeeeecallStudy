import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from '../locale-utils'

const LOCALES_DIR = join(__dirname, '../../../public/locales')

/** Recursively extract all dot-path keys from a nested object */
function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v as Record<string, unknown>, path))
    } else {
      keys.push(path)
    }
  }
  return keys.sort()
}

function loadJson(locale: string, ns: string): Record<string, unknown> {
  const filePath = join(LOCALES_DIR, locale, `${ns}.json`)
  return JSON.parse(readFileSync(filePath, 'utf-8'))
}

// Get namespaces from the default locale directory
const namespaces = readdirSync(join(LOCALES_DIR, DEFAULT_LOCALE))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''))

describe('translation file consistency', () => {
  it('every supported locale has a directory', () => {
    const dirs = readdirSync(LOCALES_DIR)
    for (const locale of SUPPORTED_LOCALES) {
      expect(dirs).toContain(locale)
    }
  })

  it('every locale has the same set of namespace files', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const files = readdirSync(join(LOCALES_DIR, locale))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''))
        .sort()
      expect(files, `${locale} is missing namespace files`).toEqual(namespaces.sort())
    }
  })

  for (const ns of namespaces) {
    describe(`${ns}.json`, () => {
      const referenceKeys = flattenKeys(loadJson(DEFAULT_LOCALE, ns))

      for (const locale of SUPPORTED_LOCALES) {
        if (locale === DEFAULT_LOCALE) continue

        it(`${locale} has all keys from ${DEFAULT_LOCALE}`, () => {
          const localeKeys = flattenKeys(loadJson(locale, ns))
          const missing = referenceKeys.filter((k) => !localeKeys.includes(k))
          expect(missing, `${locale}/${ns}.json is missing keys`).toEqual([])
        })
      }
    })
  }
})
