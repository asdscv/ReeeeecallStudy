/**
 * Unit tests for cold-start OTA swap.
 * Run with: npx tsx src/utils/cold-start-ota.test.ts
 *
 * Pure module (no RN/expo) — uses a controllable `UpdatesGate` stub to verify
 * disable rules, the happy-path swap, the timeout race, and error swallowing.
 */
import { tryColdStartOtaSwap, type UpdatesGate, type ColdStartResult } from './cold-start-ota'

let passed = 0
let failed = 0
function check(name: string, cond: boolean) {
  if (cond) passed++
  else { failed++; console.error(`  ✗ ${name}`) }
}

interface GateOptions {
  isEnabled?: boolean
  isEmergencyLaunch?: boolean
  isAvailable?: boolean
  checkDelayMs?: number
  fetchDelayMs?: number
  throwOn?: 'check' | 'fetch'
  trace?: string[]
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeGate(opts: GateOptions = {}): UpdatesGate {
  const t = opts.trace
  return {
    isEnabled: opts.isEnabled ?? true,
    isEmergencyLaunch: opts.isEmergencyLaunch ?? false,
    async checkForUpdate() {
      t?.push('check')
      if (opts.checkDelayMs) await delay(opts.checkDelayMs)
      if (opts.throwOn === 'check') throw new Error('check failed (e.g. offline)')
      return { isAvailable: opts.isAvailable ?? false }
    },
    async fetchUpdate() {
      t?.push('fetch')
      if (opts.fetchDelayMs) await delay(opts.fetchDelayMs)
      if (opts.throwOn === 'fetch') throw new Error('fetch failed')
    },
    async reload() {
      t?.push('reload')
      // Real `Updates.reloadAsync` never resolves (process restarts). In tests
      // we resolve a pending promise so the caller doesn't hang.
      return undefined as never
    },
  }
}

async function expectResult(name: string, p: Promise<ColdStartResult>, want: ColdStartResult) {
  const got = await p
  check(`${name} → ${want} (got ${got})`, got === want)
}

async function run() {
  // ── Disable rules ────────────────────────────────────────────────────────
  await expectResult('isDev=true skips entirely',
    tryColdStartOtaSwap(makeGate(), true, 3000), 'disabled')

  await expectResult('updates disabled (e.g. dev client) skips',
    tryColdStartOtaSwap(makeGate({ isEnabled: false }), false, 3000), 'disabled')

  await expectResult('emergency launch never swaps again',
    tryColdStartOtaSwap(makeGate({ isEmergencyLaunch: true }), false, 3000), 'disabled')

  // None of the disable rules should have invoked the gate at all.
  {
    const trace: string[] = []
    await tryColdStartOtaSwap(makeGate({ isEnabled: false, trace }), false, 3000)
    check('disabled: gate.check is NOT called', trace.length === 0)
  }

  // ── Happy paths ──────────────────────────────────────────────────────────
  await expectResult('no update available → no-update',
    tryColdStartOtaSwap(makeGate({ isAvailable: false }), false, 3000), 'no-update')

  {
    const trace: string[] = []
    const r = await tryColdStartOtaSwap(makeGate({ isAvailable: true, trace }), false, 3000)
    check('update available → swapping', r === 'swapping')
    check('swap order: check → fetch → reload',
      JSON.stringify(trace) === JSON.stringify(['check', 'fetch', 'reload']))
  }

  // ── Timeout race — splash must never be blocked indefinitely ─────────────
  {
    // checkForUpdate takes 5s, timeout is 1s → result must be 'timeout'.
    const start = Date.now()
    const r = await tryColdStartOtaSwap(makeGate({ checkDelayMs: 5000 }), false, 1000)
    const elapsed = Date.now() - start
    check('slow check → timeout', r === 'timeout')
    check('timeout fires near budget (≤1100ms, not 5000ms)', elapsed < 1100)
  }

  {
    // Slow fetch must also be bounded.
    const start = Date.now()
    const r = await tryColdStartOtaSwap(
      makeGate({ isAvailable: true, fetchDelayMs: 5000 }), false, 1000,
    )
    const elapsed = Date.now() - start
    check('slow fetch → timeout', r === 'timeout')
    check('fetch timeout fires near budget', elapsed < 1100)
  }

  // ── Error swallowing — boot must always continue ─────────────────────────
  await expectResult('checkForUpdate throws → error (not unhandled)',
    tryColdStartOtaSwap(makeGate({ throwOn: 'check' }), false, 3000), 'error')

  await expectResult('fetchUpdate throws → error',
    tryColdStartOtaSwap(makeGate({ isAvailable: true, throwOn: 'fetch' }), false, 3000), 'error')

  console.log(`\ncold-start-ota: ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

void run()
