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
import { readdirSync, readFileSync, statSync } from 'node:fs'
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
console.log('✓ Architecture guard passed (domain layer is clean).')
