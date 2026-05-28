import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * i18n used-key coverage guard (ratchet).
 *
 * Complements `translation-keys.test.ts` (which enforces that web locales stay
 * in parity with `en`). This test catches the *other* failure mode: code that
 * calls `t('some.key')` for a key that does NOT exist in the locale files —
 * usually masked by a `defaultValue` fallback, so it silently renders English
 * in every language. It scans the source for STATIC string-literal keys (with
 * namespace inference from `useTranslation`) and `'ns:key'` literals, then
 * asserts each exists in the `en` locale (web) / `en` + `ko` (mobile).
 *
 * Dynamic keys (template literals / variables) and files with ambiguous
 * namespaces are skipped — the guard only fails on confident misses, never
 * false positives. Legacy gaps that are out of scope live in the per-platform
 * allowlist below (internal admin tooling); any NEW miss fails the build.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..')

function flatten(obj: Record<string, unknown>, prefix = '', out: Set<string> = new Set()): Set<string> {
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Record<string, unknown>, key, out)
    else out.add(key)
  }
  return out
}

function loadLocale(dir: string): Record<string, Set<string>> {
  const nsKeys: Record<string, Set<string>> = {}
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    nsKeys[f.replace(/\.json$/, '')] = flatten(JSON.parse(readFileSync(join(dir, f), 'utf8')))
  }
  return nsKeys
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (['node_modules', '__tests__', 'dist', 'build'].includes(e) || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(e) && !e.endsWith('.d.ts')) acc.push(p)
  }
  return acc
}

interface ScanResult {
  missing: Map<string, string> // "ns:key" -> first file (repo-relative)
}

function scan(srcDir: string, localeDirs: string[], defaultNs: string): ScanResult {
  // A key must exist in EVERY provided locale dir (e.g. en + ko for mobile).
  const locales = localeDirs.map(loadLocale)
  const knownNs = new Set(Object.keys(locales[0]))
  const missing = new Map<string, string>()

  const exists = (ns: string, key: string) =>
    locales.every((loc) => loc[ns]?.has(key))

  for (const file of walk(srcDir)) {
    const text = readFileSync(file, 'utf8')
    const rel = file.replace(REPO_ROOT + '/', '')

    const nsCandidates = new Set<string>()
    for (const m of text.matchAll(/useTranslation\(\s*['"]([^'"]+)['"]/g)) nsCandidates.add(m[1])
    for (const m of text.matchAll(/useTranslation\(\s*\[\s*['"]([^'"]+)['"]/g)) nsCandidates.add(m[1])
    const fileNs =
      nsCandidates.size === 1 ? [...nsCandidates][0]
      : nsCandidates.size === 0 && /useTranslation\(\s*\)/.test(text) ? defaultNs
      : null // >1 → ambiguous → bare keys skipped

    const check = (ns: string, key: string) => {
      if (!knownNs.has(ns)) return // not an i18n namespace
      if (!exists(ns, key)) {
        const id = `${ns}:${key}`
        if (!missing.has(id)) missing.set(id, rel)
      }
    }

    // t('key' ...) / t("key" ...) — static literal first arg only
    for (const m of text.matchAll(/\bt\(\s*(['"])([^'"$\n]+?)\1/g)) {
      const raw = m[2]
      if (!raw || raw.includes('${')) continue
      if (raw.includes(':')) { const [ns, ...rest] = raw.split(':'); check(ns, rest.join(':')) }
      else if (fileNs) check(fileNs, raw)
    }
    // standalone 'ns:dotted.key' literals (e.g. labelKey constants)
    for (const m of text.matchAll(/(['"])([a-z-]+):([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\1/g)) {
      if (knownNs.has(m[2])) check(m[2], m[3])
    }
  }
  return { missing }
}

/** Out-of-scope gaps. Predicate over "ns:key". Keep this shrinking. */
const WEB_ALLOW = (id: string) =>
  id === 'marketplace:categories.' // false positive: dynamic key t('categories.' + value)

const MOBILE_ALLOW = (_id: string) => false

describe('i18n used-key coverage', () => {
  it('web: every static t() key exists in the en locale', () => {
    const { missing } = scan(
      join(REPO_ROOT, 'packages/web/src'),
      [join(REPO_ROOT, 'packages/web/public/locales/en')],
      'common',
    )
    const offenders = [...missing.entries()].filter(([id]) => !WEB_ALLOW(id))
    expect(
      offenders.map(([id, f]) => `${id}  (${f})`).sort(),
      'Static t() keys missing from web en locale (add the key, do not rely on defaultValue):',
    ).toEqual([])
  })

  it('mobile: every static t() key exists in ALL locales (no fallback for any language)', () => {
    const mobileLocales = join(REPO_ROOT, 'packages/mobile/src/i18n/locales')
    if (!existsSync(mobileLocales)) return // web-only checkout
    const localeDirs = readdirSync(mobileLocales)
      .filter((d) => statSync(join(mobileLocales, d)).isDirectory())
      .map((d) => join(mobileLocales, d))
    const { missing } = scan(join(REPO_ROOT, 'packages/mobile/src'), localeDirs, 'common')
    const offenders = [...missing.entries()].filter(([id]) => !MOBILE_ALLOW(id))
    expect(
      offenders.map(([id, f]) => `${id}  (${f})`).sort(),
      'Static t() keys missing from one or more mobile locales:',
    ).toEqual([])
  })
})
