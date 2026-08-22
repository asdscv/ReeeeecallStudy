#!/usr/bin/env node
/**
 * Session stress / load test — one session per platform.
 *
 * Exercises the deployed `register_session` / `session_heartbeat` RPCs through the
 * same PostgREST path the app uses (real user JWT, no service-role shortcut), and
 * asserts the policy invariants the "logged in on another device" screen depends on.
 *
 * Correctness scenarios
 *   A  sequential churn      — N app devices register in turn → exactly 1 app row, the last one
 *   B  cross-platform        — app + web coexist → 1 row each, neither evicts the other
 *   C  thundering herd       — K devices register at the same instant → how many rows survive?
 *   D  no steal-back         — a kicked device's HEARTBEAT must not resurrect it or evict the
 *                              winner. This is the server-side half of the ping-pong fix.
 *   E  heartbeat isolation   — the holder heartbeating repeatedly never disturbs the other platform
 *
 * Load scenarios
 *   L0 capacity probe        — serial round trip + one-shot burst, run FIRST while the edge
 *                              rate-limit bucket is still full, so the sustained numbers below
 *                              can be read as contention rather than as the throttle
 *   L1 heartbeat load        — sustained, run TWICE: distinct rows (no row-lock contention) and
 *                              one shared row (maximum contention). The comparison is the point
 *   L2 register load         — sustained concurrent registers (worst case: every call also does a
 *                              DELETE ... device_id <> $1), then re-assert the row invariant
 *
 * Usage:
 *   node scripts/session-stress-test.mjs                 # defaults below
 *   STRESS_HERD=64 STRESS_LOAD_SECONDS=20 node scripts/session-stress-test.mjs
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_ANON_KEY   target (defaults to .env.test / production)
 *   SUPABASE_SERVICE_ROLE_KEY         required only to auto-provision the throwaway test user
 *   STRESS_EMAIL, STRESS_PASSWORD     use an existing account instead of provisioning one
 *   STRESS_HERD                       concurrent registers in scenario C   (default 32)
 *   STRESS_LOAD_CONCURRENCY           in-flight requests in L1/L2          (default 24)
 *   STRESS_LOAD_SECONDS               duration of each load phase          (default 10)
 *   STRESS_KEEP_USER=1                do not delete the provisioned user afterwards
 */

const URL_BASE = process.env.SUPABASE_URL || 'https://ixdapelfikaneexnskfm.supabase.co'
const ANON = process.env.SUPABASE_ANON_KEY || 'sb_publishable_4F7XKb_Cifh2rujOiyP9RQ_ZU3HjQsV'
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const HERD = Number(process.env.STRESS_HERD || 32)
const LOAD_CONCURRENCY = Number(process.env.STRESS_LOAD_CONCURRENCY || 24)
const LOAD_SECONDS = Number(process.env.STRESS_LOAD_SECONDS || 10)
const KEEP_USER = process.env.STRESS_KEEP_USER === '1'

const results = []
let failures = 0

function check(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failures++
  const mark = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'
  console.log(`  ${mark}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/** Informational line: characterises the environment, never counted as a check. */
function note(name, detail) {
  console.log(`  \x1b[36mINFO\x1b[0m  ${name}${detail ? ` — ${detail}` : ''}`)
}

function pct(sorted, p) {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[i]
}

// ── auth ────────────────────────────────────────────────────────────────────
async function provisionUser() {
  if (process.env.STRESS_EMAIL && process.env.STRESS_PASSWORD) {
    return { email: process.env.STRESS_EMAIL, password: process.env.STRESS_PASSWORD, created: false }
  }
  if (!SERVICE_ROLE) {
    throw new Error('Set STRESS_EMAIL/STRESS_PASSWORD, or SUPABASE_SERVICE_ROLE_KEY to provision one.')
  }
  // Deterministic address so a crashed run is reused rather than littering the auth table.
  const email = 'session-stress@reeeeecallstudy.xyz'
  const password = 'StressTest!' + '9f2c1a7b'
  const res = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok && !/already been registered|already exists/i.test(JSON.stringify(body))) {
    throw new Error(`admin create user failed: ${res.status} ${JSON.stringify(body)}`)
  }
  if (!res.ok) {
    // Existing account from a previous run — force the password back to a known value.
    const list = await fetch(
      `${URL_BASE}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
      { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
    ).then((r) => r.json())
    const existing = (list.users || []).find((u) => u.email === email)
    if (!existing) throw new Error('user exists but could not be located')
    await fetch(`${URL_BASE}/auth/v1/admin/users/${existing.id}`, {
      method: 'PUT',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password, email_confirm: true }),
    })
    return { email, password, created: false, id: existing.id }
  }
  return { email, password, created: true, id: body.id }
}

async function signIn(email, password) {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(body)}`)
  return { token: body.access_token, userId: body.user.id }
}

// ── rpc ─────────────────────────────────────────────────────────────────────
function makeRpc(token) {
  return async function rpc(fn, args) {
    const started = performance.now()
    try {
      const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          apikey: ANON,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args ?? {}),
      })
      const ms = performance.now() - started
      const text = await res.text()
      let data = null
      try { data = text ? JSON.parse(text) : null } catch { data = text }
      return { ok: res.ok, status: res.status, data, ms }
    } catch (e) {
      return { ok: false, status: 0, data: String(e), ms: performance.now() - started }
    }
  }
}

const register = (rpc, deviceId, platform, name) =>
  rpc('register_session', { p_device_id: deviceId, p_device_name: name ?? `stress-${platform}`, p_platform: platform })
const heartbeat = (rpc, deviceId) => rpc('session_heartbeat', { p_device_id: deviceId })

async function sessionRows(rpc) {
  const r = await rpc('get_user_sessions', {})
  return Array.isArray(r.data) ? r.data : []
}

/** Ground truth straight from the table, including `platform` which the RPC omits. */
function makeTruth(serviceKey, userId) {
  return async function truth() {
    const res = await fetch(
      `${URL_BASE}/rest/v1/user_sessions?user_id=eq.${userId}&select=device_id,platform,created_at,last_seen_at&order=last_seen_at.desc`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    )
    if (!res.ok) throw new Error(`truth query failed: ${res.status} ${await res.text()}`)
    return res.json()
  }
}

async function wipe(serviceKey, userId) {
  await fetch(`${URL_BASE}/rest/v1/user_sessions?user_id=eq.${userId}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  })
}

// ── load driver ─────────────────────────────────────────────────────────────
async function drive(label, concurrency, seconds, makeCall) {
  const deadline = Date.now() + seconds * 1000
  const latencies = []
  let sent = 0
  let errors = 0
  const statuses = new Map()

  async function worker(slot) {
    while (Date.now() < deadline) {
      const r = await makeCall(slot, sent++)
      latencies.push(r.ms)
      statuses.set(r.status, (statuses.get(r.status) || 0) + 1)
      if (!r.ok) errors++
    }
  }

  const t0 = performance.now()
  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)))
  const elapsed = (performance.now() - t0) / 1000
  latencies.sort((a, b) => a - b)

  const rps = latencies.length / elapsed
  console.log(
    `  ${label}: ${latencies.length} calls in ${elapsed.toFixed(1)}s` +
    ` → ${rps.toFixed(0)} rps, p50 ${pct(latencies, 50).toFixed(0)}ms,` +
    ` p95 ${pct(latencies, 95).toFixed(0)}ms, p99 ${pct(latencies, 99).toFixed(0)}ms,` +
    ` max ${latencies[latencies.length - 1].toFixed(0)}ms, errors ${errors}` +
    ` [${[...statuses.entries()].map(([s, n]) => `${s}:${n}`).join(' ')}]`,
  )
  return { count: latencies.length, errors, rps, p95: pct(latencies, 95), statuses }
}

/** One-shot burst: N requests fired at once, nothing sustained. */
async function burst(label, n, makeCall) {
  const t0 = performance.now()
  const rs = await Promise.all(Array.from({ length: n }, (_, i) => makeCall(i)))
  const elapsed = (performance.now() - t0) / 1000
  const lat = rs.map((r) => r.ms).sort((a, b) => a - b)
  const errors = rs.filter((r) => !r.ok).length
  const statuses = [...new Set(rs.map((r) => r.status))].join(',')
  console.log(
    `  ${label}: ${n} concurrent in ${elapsed.toFixed(2)}s → ${(n / elapsed).toFixed(0)} rps,` +
    ` p50 ${pct(lat, 50).toFixed(0)}ms, max ${lat[n - 1].toFixed(0)}ms,` +
    ` errors ${errors} [${statuses}]`,
  )
  return { rps: n / elapsed, p50: pct(lat, 50), errors, statuses }
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nTarget: ${URL_BASE}`)
  const user = await provisionUser()
  const { token, userId } = await signIn(user.email, user.password)
  console.log(`Test user: ${user.email} (${userId})${user.created ? ' [created]' : ''}\n`)

  const rpc = makeRpc(token)
  const serviceKey = SERVICE_ROLE
  const truth = serviceKey ? makeTruth(serviceKey, userId) : null
  const reset = async () => { if (serviceKey) await wipe(serviceKey, userId) }

  await reset()

  // ── L0. capacity probe — MUST run first ───────────────────────────────────
  // The edge in front of PostgREST rate-limits a single client: a full bucket
  // absorbs a large burst, then sustained traffic is throttled to a few rps —
  // and it throttles by DELAYING, not by returning 429. So capacity has to be
  // measured before anything else drains the bucket, or every later number just
  // reports the throttle. Read L1/L2 against these two.
  console.log('L0. capacity probe (bucket full)')
  await register(rpc, 'load-holder', 'app')
  const l0serial = await drive('serial heartbeat (concurrency 1)', 1, 3,
    () => heartbeat(rpc, 'load-holder'))
  const l0burst = await burst(`one-shot burst (${LOAD_CONCURRENCY} concurrent, distinct rows)`,
    LOAD_CONCURRENCY, (i) => heartbeat(rpc, `burst-probe-${i}`))
  check('L0: a full burst of concurrent heartbeats is served without error',
    l0burst.errors === 0, `${l0burst.rps.toFixed(0)} rps, p50 ${l0burst.p50.toFixed(0)}ms [${l0burst.statuses}]`)
  // NOT a check: whether the burst parallelises depends on how full the edge's
  // rate-limit bucket happens to be, which no amount of idling reliably controls.
  // On a full bucket this reads ~56 rps / p50 485ms; drained, it collapses to the
  // same ~5 rps as everything else. Either way it says nothing about our code, so
  // it is reported and not asserted.
  const speedup = l0burst.rps / Math.max(l0serial.rps, 0.01)
  note(speedup > 2
    ? 'L0: bucket was FULL — this run measured real capacity'
    : 'L0: bucket was already DRAINED — every number below is throttle-bound, not DB-bound',
    `serial ${l0serial.rps.toFixed(1)} rps → burst ${l0burst.rps.toFixed(0)} rps (${speedup.toFixed(1)}x)`)
  await reset()

  // ── A. sequential churn ───────────────────────────────────────────────────
  console.log('A. sequential churn — 20 app devices register in turn')
  const churn = Array.from({ length: 20 }, (_, i) => `stress-app-${i}`)
  for (const d of churn) {
    const r = await register(rpc, d, 'app')
    if (!r.ok || r.data?.allowed !== true) {
      check('A: every register is allowed', false, `device ${d}: ${r.status} ${JSON.stringify(r.data)}`)
      break
    }
  }
  let rows = truth ? await truth() : await sessionRows(rpc)
  check('A: exactly 1 app session survives', rows.length === 1, `${rows.length} row(s)`)
  check('A: the survivor is the LAST device to register (latest-wins)',
    rows[0]?.device_id === churn[churn.length - 1], `survivor=${rows[0]?.device_id}`)

  // ── B. cross-platform coexistence ─────────────────────────────────────────
  console.log('\nB. cross-platform — app and web must coexist')
  await register(rpc, 'stress-web-1', 'web')
  rows = truth ? await truth() : await sessionRows(rpc)
  check('B: app + web = 2 rows', rows.length === 2, `${rows.length} row(s)`)
  if (truth) {
    check('B: one row per platform',
      new Set(rows.map((r) => r.platform)).size === 2,
      rows.map((r) => r.platform).join(','))
  }
  await register(rpc, 'stress-web-2', 'web')
  rows = truth ? await truth() : await sessionRows(rpc)
  check('B: a second web device evicts only the other web device', rows.length === 2, `${rows.length} row(s)`)
  if (truth) {
    const app = rows.find((r) => r.platform === 'app')
    check('B: the app session is untouched by web churn',
      app?.device_id === churn[churn.length - 1], `app=${app?.device_id}`)
  }

  // ── D. no steal-back (the reported ping-pong) ─────────────────────────────
  // Ordered before C so it runs against a clean, known state.
  console.log('\nD. no steal-back — a kicked device heartbeating must not evict the winner')
  await reset()
  await register(rpc, 'phone-A', 'app')
  await register(rpc, 'phone-B', 'app')            // B takes over, A is evicted
  const aBeat = await heartbeat(rpc, 'phone-A')
  check('D: the evicted device learns it was kicked',
    aBeat.data?.valid === false && aBeat.data?.reason === 'session_expired',
    JSON.stringify(aBeat.data))
  rows = truth ? await truth() : await sessionRows(rpc)
  check('D: the kicked heartbeat does NOT resurrect the evicted row', rows.length === 1, `${rows.length} row(s)`)
  check('D: the winner still holds the session', rows[0]?.device_id === 'phone-B', `holder=${rows[0]?.device_id}`)
  const bBeat = await heartbeat(rpc, 'phone-B')
  check('D: the winner is still valid after the loser heartbeats', bBeat.data?.valid === true, JSON.stringify(bBeat.data))

  // Repeat 50x: the loser hammering heartbeats must never flip the holder.
  let flips = 0
  for (let i = 0; i < 50; i++) {
    await heartbeat(rpc, 'phone-A')
    const b = await heartbeat(rpc, 'phone-B')
    if (b.data?.valid !== true) flips++
  }
  check('D: 50 loser-heartbeat rounds never unseat the holder', flips === 0, `${flips} flip(s)`)

  // ── E. heartbeat isolation across platforms ───────────────────────────────
  console.log('\nE. heartbeat isolation — heartbeats never touch the other platform')
  await register(rpc, 'stress-web-1', 'web')
  for (let i = 0; i < 20; i++) await heartbeat(rpc, 'phone-B')
  const webBeat = await heartbeat(rpc, 'stress-web-1')
  check('E: the web session survives 20 app heartbeats', webBeat.data?.valid === true, JSON.stringify(webBeat.data))

  // ── C. thundering herd ────────────────────────────────────────────────────
  console.log(`\nC. thundering herd — ${HERD} app devices register simultaneously`)
  await reset()
  const herd = Array.from({ length: HERD }, (_, i) => `herd-${i}`)
  const herdResults = await Promise.all(herd.map((d) => register(rpc, d, 'app')))
  const herdErrors = herdResults.filter((r) => !r.ok)
  const herdDeadlocks = herdResults.filter((r) => JSON.stringify(r.data).includes('40P01'))
  check('C: no request errored', herdErrors.length === 0,
    herdErrors.length ? `${herdErrors.length} error(s): ${JSON.stringify(herdErrors[0].data).slice(0, 200)}` : '0 errors')
  check('C: no deadlock (40P01)', herdDeadlocks.length === 0, `${herdDeadlocks.length}`)
  rows = truth ? await truth() : await sessionRows(rpc)
  check(`C: converges to 1 app session (concurrency ${HERD})`, rows.length === 1,
    `${rows.length} row(s) survived — >1 means concurrent registers cannot see each other's` +
    ' uncommitted INSERT, so neither DELETE evicts the other')

  // A single follow-up register must always heal whatever the race left behind.
  await register(rpc, 'herd-healer', 'app')
  rows = truth ? await truth() : await sessionRows(rpc)
  check('C: one later register heals any leftover rows', rows.length === 1, `${rows.length} row(s)`)

  // ── L1. sustained heartbeat load ──────────────────────────────────────────
  // The pair matters more than either number. `session_heartbeat` UPDATEs one row,
  // so pointing every worker at the SAME device_id is maximum row-lock contention,
  // and distinct device_ids is none at all. If the two land in the same ballpark,
  // the row lock is not what limits throughput — something upstream is.
  console.log(`\nL1. sustained heartbeat load — ${LOAD_CONCURRENCY} concurrent, ${LOAD_SECONDS}s each`)
  console.log('  (throttle-bound, not DB-bound — compare the two lines, not the absolute rps)')
  await reset()
  await register(rpc, 'load-holder', 'app')
  const l1distinct = await drive('distinct rows (no lock contention)', LOAD_CONCURRENCY, LOAD_SECONDS,
    (slot, n) => heartbeat(rpc, `load-distinct-${slot}-${n}`))
  const l1same = await drive('same row  (max lock contention)', LOAD_CONCURRENCY, LOAD_SECONDS,
    () => heartbeat(rpc, 'load-holder'))
  check('L1: throttling degrades latency, never into errors (no 429/5xx)',
    l1distinct.errors === 0 && l1same.errors === 0 &&
    [...l1distinct.statuses.keys(), ...l1same.statuses.keys()].every((st) => st >= 200 && st < 300),
    `${l1distinct.errors + l1same.errors} error(s), statuses ` +
    [...new Set([...l1distinct.statuses.keys(), ...l1same.statuses.keys()])].join(','))
  check('L1: row-lock contention is not the bottleneck (same-row ≈ distinct-row)',
    l1same.rps > l1distinct.rps * 0.6,
    `distinct ${l1distinct.rps.toFixed(1)} rps vs same-row ${l1same.rps.toFixed(1)} rps`)
  rows = truth ? await truth() : await sessionRows(rpc)
  check('L1: still exactly 1 row after the heartbeat storm', rows.length === 1, `${rows.length} row(s)`)

  // ── L2. sustained register load ───────────────────────────────────────────
  console.log(`\nL2. sustained register load — ${LOAD_CONCURRENCY} concurrent, ${LOAD_SECONDS}s`)
  console.log('  (worst case: every call is an upsert PLUS a DELETE of every other row)')
  const l2 = await drive('register', LOAD_CONCURRENCY, LOAD_SECONDS,
    (slot, n) => register(rpc, `load-dev-${slot}-${n % 5}`, 'app'))
  check('L2: no register errors under load', l2.errors === 0, `${l2.errors}/${l2.count}`)
  check('L2: no throttling or server errors surfaced (all 2xx)',
    [...l2.statuses.keys()].every((st) => st >= 200 && st < 300),
    [...l2.statuses.entries()].map(([st, n]) => `${st}:${n}`).join(' '))
  await register(rpc, 'load-final', 'app')
  rows = truth ? await truth() : await sessionRows(rpc)
  check('L2: converges to 1 row after the storm', rows.length === 1, `${rows.length} row(s)`)
  check('L2: no ghost-row accumulation', rows.length <= 2, `${rows.length} row(s)`)

  // ── cleanup ───────────────────────────────────────────────────────────────
  await reset()
  if (user.created && !KEEP_USER && SERVICE_ROLE && user.id) {
    await fetch(`${URL_BASE}/auth/v1/admin/users/${user.id}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
    })
    console.log('\nCleaned up the provisioned test user.')
  }

  console.log(`\n${'─'.repeat(70)}`)
  console.log(`${results.length - failures}/${results.length} checks passed`)
  if (failures) {
    console.log('\nFailures:')
    for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.detail}`)
  }
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error('\nstress test aborted:', e)
  process.exit(2)
})
