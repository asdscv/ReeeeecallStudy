/**
 * Reason codes: planner → screen mapping → every locale.
 *
 * The gap this closes is one that already happened once. `reasonCode` is produced in the shared
 * planner and rendered through a per-platform `REASON_KEY` table with a `?? 'today.reason.balanced'`
 * fallback. So a new feature — `memory_risk` in daily-plan-v2 — shows up as "Balanced mix" on both
 * platforms if nobody adds a phrase: no crash, no missing-key warning, just a row that states the
 * wrong reason in eight languages.
 *
 * The list of codes is therefore read from the PLANNER SOURCE rather than restated here. Adding a
 * feature to `FEATURES` without giving it a phrase in all 16 locale files fails this test.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const LOCALES = ['en', 'es', 'id', 'ja', 'ko', 'th', 'vi', 'zh'] as const

const SCREENS = [
  {
    platform: 'web',
    source: 'packages/web/src/pages/learning/LearningTodayPage.tsx',
    localeDir: (lang: string) => `packages/web/public/locales/${lang}/learning.json`,
  },
  {
    platform: 'mobile',
    source: 'packages/mobile/src/screens/LearningTodayScreen.tsx',
    localeDir: (lang: string) => `packages/mobile/src/i18n/locales/${lang}/learning.json`,
  },
] as const

const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8')

/** Every reason code `buildDailyPlan` can put on an item, taken from the planner itself. */
function plannerReasonCodes(): string[] {
  const source = read('packages/shared/learning/application/daily-planner.ts')
  const codes = [...source.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1])
  const fallback = source.match(/\?\? '([a-z_]+)'/)?.[1]
  expect(codes.length).toBeGreaterThan(0)     // never pass vacuously
  expect(fallback).toBeTruthy()
  return [...codes, fallback as string]
}

/** The screen's `REASON_KEY` table, parsed out of its source. */
function reasonKeyTable(source: string): Record<string, string> {
  const block = source.match(/const REASON_KEY: Record<string, string> = \{([\s\S]*?)\n\}/)
  expect(block).toBeTruthy()
  const table: Record<string, string> = {}
  for (const m of (block as RegExpMatchArray)[1].matchAll(/([a-z_]+):\s*'([^']+)'/g)) table[m[1]] = m[2]
  return table
}

const lookup = (data: unknown, key: string): unknown => {
  let cur: unknown = data
  for (const part of key.split('.')) {
    if (typeof cur !== 'object' || cur === null || !(part in (cur as object))) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

describe('planner reason codes are renderable on every platform, in every language', () => {
  const codes = plannerReasonCodes()

  it('includes the memory model feature — the reason daily-plan-v2 exists', () => {
    expect(codes).toContain('memory_risk')
  })

  for (const screen of SCREENS) {
    it(`${screen.platform}: maps every code and every mapped key resolves in all 8 locales`, () => {
      const table = reasonKeyTable(read(screen.source))
      for (const code of codes) {
        expect(table[code], `${screen.platform} has no phrase for reason code "${code}"`).toBeTruthy()
      }
      for (const lang of LOCALES) {
        const bundle = JSON.parse(read(screen.localeDir(lang)))
        for (const code of codes) {
          const value = lookup(bundle, table[code])
          expect(typeof value, `${screen.platform}/${lang} missing ${table[code]}`).toBe('string')
          expect(String(value).trim().length).toBeGreaterThan(0)
        }
      }
    })
  }

  it('uses the same set of codes on both platforms', () => {
    const [web, mobile] = SCREENS.map((s) => Object.keys(reasonKeyTable(read(s.source))).sort())
    expect(web).toEqual(mobile)
  })
})
