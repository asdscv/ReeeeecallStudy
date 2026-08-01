/**
 * Nothing in the learning kernel may be exported without a reader.
 *
 * This is the guard the cleanup earns. The kernel was built top-down — domain model, ports,
 * registries, evaluators, validators — and only one path was ever wired: cards →
 * `activitiesForLegacyCard` → `buildCandidatesFromCards` → `buildDailyPlan` → `save_daily_plan`.
 * Everything else compiled, typechecked, and read from the outside exactly like a working
 * feature. Three separate rounds of work were spent discovering, each time, that a capability
 * did nothing:
 *
 *   #400  the domain list was hard-coded into two screens; `LearningDomainRegistry` had no importer
 *   #402  four `LearningDomainAdapter` members had no reader — one of them made its own
 *         domain's remediation unsatisfiable and returned 400 for every request
 *   here  `ports/` entirely, `domain/validators.ts`, `domain/result.ts`, 9 error factories,
 *         and 22 domain types — 0 readers between them
 *
 * A compiler cannot see this: an exported symbol nobody imports is not an error. So the check
 * has to be written down. It costs one line of thought when adding an export — "who reads it?" —
 * which is exactly the question that went unasked for three rounds.
 *
 * A test counts as a reader. Pinning behaviour you intend to ship is legitimate; the failure
 * mode this catches is code with NO reader at all.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const REPO_ROOT = join(__dirname, '../../../../..')
const KERNEL = join(REPO_ROOT, 'packages/shared/learning')
const SCAN_ROOTS = ['packages/shared', 'packages/web/src', 'packages/mobile/src', 'supabase/functions']

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    // `.js` is deliberately excluded: stale compiled twins of `.ts` files are gitignored but
    // present locally, and counting them would let a deleted reader keep a symbol alive.
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

/** Every exported symbol of the kernel, excluding barrels (which only re-export). */
function kernelExports(): Array<{ name: string; file: string }> {
  const out: Array<{ name: string; file: string }> = []
  for (const file of walk(KERNEL)) {
    if (file.endsWith('/index.ts')) continue
    const source = readFileSync(file, 'utf-8')
    for (const m of source.matchAll(/^export (?:declare )?(?:abstract )?(?:async )?(?:function|const|class|interface|type|enum) (\w+)/gm)) {
      out.push({ name: m[1], file: relative(REPO_ROOT, file) })
    }
  }
  return out
}

const ALL_SOURCES = SCAN_ROOTS.flatMap((root) => walk(join(REPO_ROOT, root)))
  .map((file) => ({ path: relative(REPO_ROOT, file), text: readFileSync(file, 'utf-8') }))

describe('learning kernel has no dead exports', () => {
  const exports = kernelExports()

  it('finds the kernel at all', () => {
    // A guard that silently scans nothing passes forever. Pin that the walk is really working.
    expect(exports.length).toBeGreaterThan(10)
    expect(exports.map((e) => e.name)).toContain('buildDailyPlan')
  })

  it.each(exports.map((e) => [e.name, e.file] as const))('%s (%s) is read somewhere', (name, file) => {
    const word = new RegExp(`\\b${name}\\b`)
    const readers = ALL_SOURCES.filter((source) => source.path !== file && word.test(source.text))
    expect(
      readers.length,
      `${file} exports "${name}", and nothing outside that file mentions it. `
      + 'Delete it, or add the caller that justifies it in the same change.',
    ).toBeGreaterThan(0)
  })
})
