#!/usr/bin/env tsx
/**
 * Architecture guard — domain layer must not import supabase.
 *
 * 표준: DOCS/STANDARD/01_ARCHITECTURE — "헥사고날 의존성 방향"
 *
 * Rule:
 *   `packages/shared/lib/**` (domain pure functions) MUST NOT import
 *   from `supabase` or `@supabase/supabase-js`. Only stores (use cases)
 *   and adapters are allowed to touch the data adapter.
 *
 * Exit code:
 *   0 — clean
 *   1 — violations found
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname ?? __dirname, '..')
const DOMAIN_ROOTS = [
  'packages/shared/lib',
  // Add more pure-domain dirs as the project grows
]

const FORBIDDEN = [
  /from\s+['"](.*\/)?lib\/supabase['"]/,
  /from\s+['"]@supabase\/supabase-js['"]/,
  /from\s+['"]@reeeeecall\/shared\/lib\/supabase['"]/,
]

// Allowlist — files that are themselves the supabase adapter or are
// explicitly approved to import it (init/getter only).
const ALLOWLIST = new Set([
  'packages/shared/lib/supabase.ts',
  'packages/shared/lib/rate-limit-instance.ts', // contains guard fixture
])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec|d)\./.test(name)) {
      out.push(full)
    }
  }
  return out
}

let violations = 0
for (const root of DOMAIN_ROOTS) {
  const abs = join(ROOT, root)
  for (const file of walk(abs)) {
    const rel = relative(ROOT, file).replaceAll('\\', '/')
    if (ALLOWLIST.has(rel)) continue
    const src = readFileSync(file, 'utf8')
    for (const pat of FORBIDDEN) {
      if (pat.test(src)) {
        console.error(`✗ ${rel} imports a forbidden adapter: ${pat}`)
        violations++
        break
      }
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} architecture violation(s) found.`)
  process.exit(1)
}

// ── Rule 2: the study logic has exactly one implementation ──────────────────
// `packages/web` used to carry a byte-near-identical copy of the study engine.
// Every change had to be mirrored by hand, and a missed mirror was invisible:
// web tests exercised the web copy, so mobile could silently keep old behaviour.
// P7 deleted the copy. Re-adding any of these paths — even as a re-export shim,
// which is what split the supabase mock paths and broke 68 tests before #342 —
// fails here.
const SINGLE_SOURCE_ONLY = [
  'packages/web/src/lib/srs.ts',
  'packages/web/src/lib/study-queue.ts',
  'packages/web/src/lib/cramming-queue.ts',
  'packages/web/src/lib/study-session-utils.ts',
  'packages/web/src/lib/srs-access.ts',
  'packages/web/src/stores/study-store.ts',
]

let duplicates = 0
for (const rel of SINGLE_SOURCE_ONLY) {
  if (existsSync(join(ROOT, rel))) {
    console.error(`✗ ${rel} re-appeared — study logic lives only in packages/shared`)
    duplicates++
  }
}

if (duplicates > 0) {
  console.error(`\n${duplicates} duplicated study module(s) found. Import from @reeeeecall/shared instead.`)
  process.exit(1)
}

console.log('✓ Architecture guard passed (domain layer is clean, study logic is single-source).')
