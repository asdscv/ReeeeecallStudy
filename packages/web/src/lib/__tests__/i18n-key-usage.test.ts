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

  // A key is satisfied if it exists literally OR as an i18next CLDR plural set:
  // t('x', { count }) resolves to x_one / x_other / x_zero / … so the base key
  // 'x' is correctly defined when those variants exist.
  const PLURAL_SUFFIXES = ['', '_zero', '_one', '_two', '_few', '_many', '_other']
  const exists = (ns: string, key: string) =>
    locales.every((loc) => {
      const set = loc[ns]
      return !!set && PLURAL_SUFFIXES.some((s) => set.has(key + s))
    })

  for (const file of walk(srcDir)) {
    const text = readFileSync(file, 'utf8')
    const rel = file.replace(REPO_ROOT + '/', '')

    const check = (ns: string, key: string) => {
      if (!knownNs.has(ns)) return // not an i18n namespace
      if (!exists(ns, key)) {
        const id = `${ns}:${key}`
        if (!missing.has(id)) missing.set(id, rel)
      }
    }

    // Map each t-alias to its namespace. Handles aliased + multiple
    // useTranslation calls in one file (e.g. `const { t } = useTranslation('decks')`
    // alongside `const { t: tm } = useTranslation('marketplace')`), which the old
    // single-namespace heuristic skipped — that blind spot let aliased usages drift.
    const aliasSets: Record<string, Set<string>> = {}
    for (const m of text.matchAll(
      /const\s*\{\s*t(?:\s*:\s*(\w+))?\s*(?:,[^}]*)?\}\s*=\s*useTranslation\(\s*(\[[^\]]*\]|['"][^'"]+['"])\s*\)/g,
    )) {
      const alias = m[1] || 't'
      const first = m[2].match(/['"]([^'"]+)['"]/) // string arg, or first element of array (= default ns)
      if (first) (aliasSets[alias] ??= new Set()).add(first[1])
    }
    if (Object.keys(aliasSets).length === 0 && /useTranslation\(\s*\)/.test(text)) aliasSets['t'] = new Set([defaultNs])
    // An alias rebound to >1 namespace in one file (e.g. `const { t } = useTranslation('landing')`
    // in one scope and `useTranslation('auth')` in another) is ambiguous → resolve only its
    // explicit `ns:key` calls, skip bare keys, to avoid false attribution.
    const aliasNs: Record<string, string | null> = {}
    for (const [a, set] of Object.entries(aliasSets)) aliasNs[a] = set.size === 1 ? [...set][0] : null
    const aliasGroup = Object.keys(aliasNs).map((a) => a.replace(/\$/g, '\\$')).join('|')

    // ALIAS('key' ...) — the alias resolves the namespace; 'ns:key' overrides.
    if (aliasGroup) {
      for (const m of text.matchAll(new RegExp(`\\b(${aliasGroup})\\(\\s*(['"])([^'"$\\n]+?)\\2`, 'g'))) {
        const raw = m[3]
        // Skip dynamic/concat artifacts: `t('categories.' + value)` captures the
        // literal prefix "categories." which is not a real key.
        if (!raw || raw.includes('${') || raw.endsWith('.')) continue
        if (raw.includes(':')) { const [ns, ...rest] = raw.split(':'); check(ns, rest.join(':')) }
        else { const ns = aliasNs[m[1]]; if (ns) check(ns, raw) } // null = ambiguous alias → skip bare key
      }
    }
    // standalone 'ns:dotted.key' literals (e.g. labelKey constants)
    for (const m of text.matchAll(/(['"])([a-z-]+):([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\1/g)) {
      if (knownNs.has(m[2])) check(m[2], m[3])
    }
  }
  return { missing }
}

/** Out-of-scope gaps. Predicate over "ns:key". Empty — no allowlisted misses. */
const WEB_ALLOW = (_id: string) => false

const MOBILE_ALLOW = (_id: string) => false

function mobileLocaleDirs(root: string): string[] | null {
  const base = join(root, 'packages/mobile/src/i18n/locales')
  if (!existsSync(base)) return null
  return readdirSync(base).filter((d) => statSync(join(base, d)).isDirectory())
}

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

  it('mobile: every locale has full key parity with en (no drift, no fallback in any language)', () => {
    const dirs = mobileLocaleDirs(REPO_ROOT)
    if (!dirs) return
    const base = join(REPO_ROOT, 'packages/mobile/src/i18n/locales')
    const en = loadLocale(join(base, 'en'))
    const diffs: string[] = []
    for (const loc of dirs.filter((d) => d !== 'en')) {
      const locKeys = loadLocale(join(base, loc))
      for (const ns of Object.keys(en)) {
        for (const key of en[ns]) if (!locKeys[ns]?.has(key)) diffs.push(`${loc}/${ns}: MISSING ${key}`)
      }
      for (const ns of Object.keys(locKeys)) {
        for (const key of locKeys[ns]) if (!en[ns]?.has(key)) diffs.push(`${loc}/${ns}: ORPHAN ${key}`)
      }
    }
    // Mirrors web's translation-keys parity, now feasible after the structural
    // drift cleanup. en is the source of truth: every locale must match it exactly.
    expect(diffs.sort(), 'Mobile locale key drift vs en (fill missing / prune orphans):').toEqual([])
  })
})
