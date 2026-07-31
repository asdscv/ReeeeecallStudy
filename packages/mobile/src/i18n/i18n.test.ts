/**
 * i18n validation tests — run with: npx tsx src/i18n/i18n.test.ts
 *
 * Checks:
 * 1. Every supported language has all required namespace files
 * 2. Every JSON file is valid
 * 3. Every language has the same top-level keys as English (reference)
 * 4. No empty translation values
 */
import * as fs from 'fs'
import * as path from 'path'

const LOCALES_DIR = path.join(__dirname, 'locales')

// ── Config: single source of truth ──
const SUPPORTED_LANGS = ['en', 'ko', 'ja', 'zh', 'vi', 'th', 'id', 'es'] as const
const NAMESPACES = [
  'common', 'auth', 'dashboard', 'decks', 'study',
  'marketplace', 'settings', 'history', 'import-export',
  'guide', 'errors', 'paywall', 'update',
  'learning',
] as const

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++
  } else {
    failed++
    console.error(`  FAIL: ${msg}`)
  }
}

// ── Test 1: All locale directories exist ──
console.log('\n[Test 1] Locale directories exist')
for (const lang of SUPPORTED_LANGS) {
  const dir = path.join(LOCALES_DIR, lang)
  assert(fs.existsSync(dir), `Missing locale directory: ${lang}`)
}

// ── Test 2: All namespace files exist and are valid JSON ──
console.log('[Test 2] Namespace files exist and are valid JSON')
for (const lang of SUPPORTED_LANGS) {
  for (const ns of NAMESPACES) {
    const file = path.join(LOCALES_DIR, lang, `${ns}.json`)
    assert(fs.existsSync(file), `Missing: ${lang}/${ns}.json`)
    if (fs.existsSync(file)) {
      try {
        JSON.parse(fs.readFileSync(file, 'utf-8'))
      } catch {
        assert(false, `Invalid JSON: ${lang}/${ns}.json`)
      }
    }
  }
}

// ── Test 3: All languages have same top-level keys as English ──
console.log('[Test 3] Key consistency with English (reference)')
for (const ns of NAMESPACES) {
  const enFile = path.join(LOCALES_DIR, 'en', `${ns}.json`)
  if (!fs.existsSync(enFile)) continue
  const enKeys = Object.keys(JSON.parse(fs.readFileSync(enFile, 'utf-8'))).sort()

  for (const lang of SUPPORTED_LANGS) {
    if (lang === 'en') continue
    const file = path.join(LOCALES_DIR, lang, `${ns}.json`)
    if (!fs.existsSync(file)) continue
    const langKeys = Object.keys(JSON.parse(fs.readFileSync(file, 'utf-8'))).sort()

    const missing = enKeys.filter((k) => !langKeys.includes(k))
    assert(
      missing.length === 0,
      `${lang}/${ns}.json missing keys: ${missing.join(', ')}`,
    )
  }
}

// ── Test 4: No empty string values (top level) ──
console.log('[Test 4] No empty translation values')
for (const lang of SUPPORTED_LANGS) {
  for (const ns of NAMESPACES) {
    const file = path.join(LOCALES_DIR, lang, `${ns}.json`)
    if (!fs.existsSync(file)) continue
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
    const emptyKeys = Object.entries(data)
      .filter(([, v]) => typeof v === 'string' && v.trim() === '')
      .map(([k]) => k)
    assert(
      emptyKeys.length === 0,
      `${lang}/${ns}.json has empty values: ${emptyKeys.join(', ')}`,
    )
  }
}

// ── Test 5: every {{x, <fmt>}} spec used in a locale has an Intl-free override ──
// i18next's built-in formatters go through Intl, which silently drops thousands separators
// on a Hermes build without full ICU. src/i18n/index.ts overrides `number` for that reason;
// this guards both directions — the override must not disappear while locales rely on it,
// and a NEW format spec must not be introduced without an override.
console.log('[Test 5] Locale format specs have Intl-free overrides')
{
  const specs = new Set<string>()
  for (const lang of SUPPORTED_LANGS) {
    for (const ns of NAMESPACES) {
      const file = path.join(LOCALES_DIR, lang, `${ns}.json`)
      if (!fs.existsSync(file)) continue
      const raw = fs.readFileSync(file, 'utf-8')
      for (const m of raw.matchAll(/\{\{\s*[a-zA-Z0-9_]+\s*,\s*([a-zA-Z]+)/g)) specs.add(m[1])
    }
  }
  const config = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf-8')
  for (const spec of specs) {
    assert(
      new RegExp(`formatter\\??\\.add\\(\\s*['"\`]${spec}['"\`]`).test(config),
      `locales use {{x, ${spec}}} but src/i18n/index.ts registers no Intl-free '${spec}' formatter ` +
        `— on a Hermes build without full ICU it would silently drop separators`,
    )
  }
}

// ── Summary ──
console.log(`\n✅ Passed: ${passed}`)
if (failed > 0) {
  console.log(`❌ Failed: ${failed}`)
  process.exit(1)
} else {
  console.log('All i18n tests passed!')
}
