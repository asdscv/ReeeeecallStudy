/**
 * A chart tooltip must show the NUMBER.
 *
 * `StudyVolumeChart` passed `t('units.cards', { count })` into recharts' value slot. That key
 * is the bare word "장" with no interpolation, so `count` was ignored and the value slot
 * rendered the unit a second time: the tooltip read
 *
 *     2026-07-20
 *     장 : 장
 *     세션 : 세션
 *
 * with the number nowhere on screen. Nothing failed — i18n key-usage passes (the key exists),
 * plural parity passes (nothing to inflect), and the chart still drew its bars. It is only
 * visible by hovering, and it survived because no test ever asked what the tooltip says.
 *
 * So this asserts the property directly on the locale data: any string used to render a
 * COUNT must have somewhere for the count to go. Checked in every locale, because a
 * placeholder dropped from one translation fails exactly the same way and only for the
 * learners who read that language.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const LOCALES = ['en', 'ko', 'ja', 'zh', 'vi', 'th', 'id', 'es'] as const

/**
 * Keys the charts render a measured number through. Each must interpolate — the whole point
 * of the string is the number, so one without a placeholder is a silently empty readout.
 */
const COUNTED_KEYS: Array<[namespace: string, path: string]> = [
  ['history', 'charts.sessionCountLabel'],
  ['history', 'charts.cardCountLabel'],
  ['history', 'charts.sessionCount'],
  ['history', 'charts.volumeSummary'],
]

/** Bare unit words. These are LABELS, and using one as a value is the bug above. */
const BARE_UNIT_KEYS: Array<[namespace: string, path: string]> = [
  ['history', 'units.sessions'],
  ['history', 'units.cards'],
  ['history', 'units.min'],
]

const read = (locale: string, ns: string) =>
  JSON.parse(readFileSync(join(ROOT, 'packages/web/public/locales', locale, `${ns}.json`), 'utf-8'))

const at = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj)

describe('chart tooltips render numbers, not their own units', () => {
  for (const locale of LOCALES) {
    it(`${locale}: every counted chart string has a placeholder`, () => {
      const missing: string[] = []
      for (const [ns, path] of COUNTED_KEYS) {
        const value = at(read(locale, ns), path)
        if (typeof value !== 'string' || !/\{\{/.test(value)) {
          missing.push(`${ns}:${path} = ${JSON.stringify(value)}`)
        }
      }
      expect(missing, `${locale} has counted chart strings with nowhere to put the count`)
        .toEqual([])
    })

    it(`${locale}: the bare unit words stay bare`, () => {
      // If one of these ever grows a placeholder, someone has started using it as a value —
      // which is the same mistake wearing different clothes.
      const wrong: string[] = []
      for (const [ns, path] of BARE_UNIT_KEYS) {
        const value = at(read(locale, ns), path)
        if (typeof value === 'string' && /\{\{/.test(value)) {
          wrong.push(`${ns}:${path} = ${JSON.stringify(value)}`)
        }
      }
      expect(wrong, `${locale}: a unit LABEL gained an interpolation`).toEqual([])
    })
  }

  it('the volume chart uses the counted keys, not the bare units, for its values', () => {
    // The regression is in the component, so read it: the value slot of the tooltip must not
    // be built from `units.*`.
    const src = readFileSync(
      join(ROOT, 'packages/web/src/components/study-history/StudyVolumeChart.tsx'), 'utf-8')
    const formatter = src.slice(src.indexOf('<Tooltip'), src.indexOf('<Legend'))

    expect(formatter).toContain('charts.sessionCountLabel')
    expect(formatter).toContain('charts.cardCountLabel')
    // `units.*` may still appear — as the NAME. What must never come back is passing a count
    // to it, which is what produced "장 : 장".
    expect(formatter).not.toMatch(/units\.(sessions|cards)',\s*\{\s*count/)
  })
})
