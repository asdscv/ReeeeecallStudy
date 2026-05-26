/**
 * Unit tests for theme → native appearance mapping.
 * Run with: npx tsx src/utils/color-scheme.test.ts
 *
 * Locks in the RN-version-specific contract: "system" must map to 'unspecified'
 * (not null), which was the root cause of the theme-store type/runtime defect.
 */
import { toAppearanceColorScheme } from './color-scheme'

let passed = 0
let failed = 0
function check(name: string, cond: boolean) {
  if (cond) {
    passed++
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

check("system -> 'unspecified' (NOT null)", toAppearanceColorScheme('system') === 'unspecified')
check('light -> light', toAppearanceColorScheme('light') === 'light')
check('dark -> dark', toAppearanceColorScheme('dark') === 'dark')
check('never returns null/undefined', toAppearanceColorScheme('system') != null)

console.log(`\ncolor-scheme: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
