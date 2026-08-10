/**
 * Nothing in the AI hub kernel may be exported without a reader.
 *
 * `learning-kernel-no-dead-exports.test.ts` explains why this check has to be written down: an
 * exported symbol nobody imports is not a compiler error, and the learning kernel spent three
 * rounds shipping capabilities that did nothing while typechecking and reading, from the outside,
 * exactly like working features. That guard scans `packages/shared/learning` only, so a second
 * kernel needs a second guard or it inherits none of the lesson.
 *
 * The risk is concrete here. A registry and an event bus are precisely the kind of thing that
 * gets built with more surface than the first feature needs — an `off()`, a `clear()`, a
 * `listenerCount()` — and then the extra surface is maintained forever on the strength of a
 * future that never arrives. If a method is worth keeping, something reads it. A test counts as
 * a reader: pinning behaviour you intend to ship is legitimate.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const REPO_ROOT = join(__dirname, '../../../../..')
const KERNEL_DIRS = ['packages/shared/lib/kernel', 'packages/shared/lib/ai/hub']
const SCAN_ROOTS = ['packages/shared', 'packages/web/src', 'packages/mobile/src', 'supabase/functions']

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    // `.js` excluded for the same reason the learning guard excludes it: gitignored compiled
    // twins are present locally and would keep a deleted reader's symbol alive.
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

function kernelExports(): Array<{ name: string; file: string }> {
  const out: Array<{ name: string; file: string }> = []
  for (const dir of KERNEL_DIRS) {
    for (const file of walk(join(REPO_ROOT, dir))) {
      const source = readFileSync(file, 'utf-8')
      for (const m of source.matchAll(
        /^export (?:declare )?(?:abstract )?(?:async )?(?:function|const|class|interface|type) (\w+)/gm,
      )) {
        out.push({ name: m[1], file: relative(REPO_ROOT, file) })
      }
    }
  }
  return out
}

const ALL_SOURCES = SCAN_ROOTS.flatMap((root) => walk(join(REPO_ROOT, root))).map((file) => ({
  path: relative(REPO_ROOT, file),
  text: readFileSync(file, 'utf-8'),
}))

describe('AI hub kernel has no dead exports', () => {
  const exports = kernelExports()

  it('finds the kernel at all', () => {
    // A moved or renamed directory would make every assertion below vacuously pass.
    expect(exports.length).toBeGreaterThan(10)
  })

  it.each(exports.map((e) => [`${e.name} (${e.file})`, e]))('%s has a reader', (_label, entry) => {
    const symbol = (entry as { name: string; file: string }).name
    const declaredIn = (entry as { name: string; file: string }).file
    const wordBoundary = new RegExp(`\\b${symbol}\\b`)
    const readers = ALL_SOURCES.filter((s) => s.path !== declaredIn && wordBoundary.test(s.text))
    expect(readers.map((r) => r.path), `${symbol} is exported from ${declaredIn} but nothing reads it`)
      .not.toHaveLength(0)
  })
})
