/**
 * Unit tests for the app-update gate domain logic.
 * Run with: npx tsx src/services/app-update/app-update.test.ts
 *
 * Covers the real decision surface: tolerant version parsing/comparison and the
 * fail-open gate (block below min, soft-prompt below latest, ok otherwise, and
 * — critically — never block on missing/garbage input).
 */
import { parseVersion, compareVersions, isOlderThan } from './version'
import { evaluateUpdateGate } from './gate'
import type { UpdateRequirement } from './types'

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

// ── parseVersion ──
check('parses x.y.z', JSON.stringify(parseVersion('1.2.3')) === JSON.stringify({ major: 1, minor: 2, patch: 3 }))
check('parses x.y -> patch 0', parseVersion('2.5')?.patch === 0 && parseVersion('2.5')?.minor === 5)
check('parses x -> minor/patch 0', parseVersion('3')?.major === 3 && parseVersion('3')?.patch === 0)
check('strips leading v', parseVersion('v1.0.1')?.major === 1)
check('ignores pre-release suffix', parseVersion('1.2.3-beta.1')?.patch === 3)
check('ignores build suffix', parseVersion('1.2.3+42')?.patch === 3)
check('truncates x.y.z.w to three', parseVersion('1.2.3.4')?.patch === 3)
check('null on empty', parseVersion('') === null)
check('null on garbage', parseVersion('abc') === null)
check('null on undefined', parseVersion(undefined) === null)
check('null on partial garbage', parseVersion('1.x.0') === null)

// ── compareVersions ──
check('1.0.0 < 1.0.1', compareVersions('1.0.0', '1.0.1') === -1)
check('1.2.0 > 1.1.9', compareVersions('1.2.0', '1.1.9') === 1)
check('equal versions', compareVersions('1.0.1', '1.0.1') === 0)
check('major dominates minor/patch', compareVersions('2.0.0', '1.9.9') === 1)
check('garbage compares equal (fail-open)', compareVersions('abc', '1.0.0') === 0)
check('isOlderThan true', isOlderThan('1.0.0', '1.0.1'))
check('isOlderThan false when newer', !isOlderThan('1.0.2', '1.0.1'))
check('isOlderThan false on garbage', !isOlderThan('abc', '1.0.1'))

// ── evaluateUpdateGate ──
const req = (min: string, latest: string | null = null): UpdateRequirement => ({
  minSupportedVersion: min,
  latestVersion: latest,
  storeUrl: null,
  message: null,
})

check('blocks when below min', evaluateUpdateGate('1.0.0', req('1.1.0')).status === 'blocked')
check('ok when exactly at min', evaluateUpdateGate('1.1.0', req('1.1.0')).status === 'ok')
check('ok when above min', evaluateUpdateGate('1.2.0', req('1.1.0')).status === 'ok')
check('optional when below latest but >= min', evaluateUpdateGate('1.1.0', req('1.0.0', '1.2.0')).status === 'optional')
check('block beats optional', evaluateUpdateGate('1.0.0', req('1.1.0', '1.3.0')).status === 'blocked')
check('ok when at latest', evaluateUpdateGate('1.2.0', req('1.0.0', '1.2.0')).status === 'ok')

// ── fail-open guarantees (the safety contract) ──
check('no requirement -> ok', evaluateUpdateGate('1.0.0', null).status === 'ok')
check('unparseable current -> ok (never block)', evaluateUpdateGate('', req('9.9.9')).status === 'ok')
check('unparseable min -> ok', evaluateUpdateGate('1.0.0', req('not-a-version')).status === 'ok')
check('result echoes evaluated current version', evaluateUpdateGate('1.0.0', req('1.1.0')).currentVersion === '1.0.0')

console.log(`\napp-update: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
