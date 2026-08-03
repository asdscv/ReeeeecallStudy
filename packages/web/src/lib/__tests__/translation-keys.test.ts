import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from '../locale-utils'
import pluralDebt from './plural-debt.json'

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

/**
 * Counted strings must inflect in the languages that inflect.
 *
 * `{{count, number}}` alone does NOT make a string plural-aware — i18next picks `key_one` /
 * `key_other` at call time, and a bare `key` is used at every count. The dashboard streak read
 * "1 days" for exactly this reason, in the same change that fixed it reading "0days".
 *
 * The key-parity suite above cannot see this: `streakDays` existed in all eight locales, so
 * parity was satisfied while English was ungrammatical at count 1.
 *
 * ── Why a baseline and not a clean sweep ────────────────────────────────────
 *
 * 107 keys were already in this state when the rule was written. Fixing them means inventing
 * singular forms in eight languages for strings nobody reported — real work, and not the work
 * this change is doing. They are listed in `plural-debt.json` so the debt is COUNTABLE and
 * visible instead of invisible, and so that a NEW counted key cannot join them silently.
 *
 * Removing an entry from that file is how you fix one. The list should only ever shrink; adding
 * to it should require saying why in review.
 */
describe('counted keys inflect', () => {
  /** Known-broken today. See the note above: this list should only shrink. */
  const DEBT: Set<string> = new Set(pluralDebt as string[])

  /** English is the reference for grammar here: it is the locale in this repo that inflects. */
  const INFLECTING = ['en', 'es'] as const

  for (const ns of namespaces) {
    it(`${ns}.json counted keys have _one and _other`, () => {
      const reference = loadJson(DEFAULT_LOCALE, ns) as Record<string, unknown>
      const flat = flattenKeys(reference)

      // A key is "counted" when its own value interpolates `count`. Suffixed variants are the
      // ANSWER, not the question, so they are not themselves candidates.
      const counted = flat.filter((key) => {
        if (/_(one|other|two|few|many|zero)$/.test(key)) return false
        const value = key.split('.').reduce<unknown>(
          (cur, part) => (cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[part] : undefined),
          reference,
        )
        return typeof value === 'string' && /\{\{\s*count\s*[,}]/.test(value)
      })

      const broken: string[] = []
      for (const locale of INFLECTING) {
        const data = loadJson(locale, ns) as Record<string, unknown>
        const keys = flattenKeys(data)
        for (const key of counted) {
          if (DEBT.has(`${ns}:${key}`)) continue
          if (!keys.includes(`${key}_one`) || !keys.includes(`${key}_other`)) {
            broken.push(`${ns}:${key}`)
          }
        }
      }
      expect(
        [...new Set(broken)].sort(),
        'new counted key with no _one/_other — it would read "1 days". Add both forms, or add it '
          + 'to plural-debt.json with a reason if it is genuinely invariant.',
      ).toEqual([])
    })
  }
})
