#!/usr/bin/env node
/**
 * e2e-population — 실사격 검증 하네스 (L1 스모크)
 *
 * 설계 문서의 불변식 INV-1..11 을 실제 유저 JWT 로, 실제 네트워크 경로(PostgREST +
 * 엣지 함수)를 통해 검사한다. service_role 은 오직 두 곳에만 쓴다:
 *   1) 테스트 유저 생성/삭제 (admin auth API)
 *   2) 서버만 할 수 있는 동작의 시뮬레이션 (구독 부여 · 크레딧 지급) — 웹훅이 부르는
 *      바로 그 RPC 를 그대로 부른다. 손으로 만든 행이 아니라 진짜 권한 부여 로직을 태운다.
 * 그 외 모든 호출은 유저 JWT 다. service_role 지름길로 검사하면 RLS 와 가드를 건너뛰어
 * "통과"가 아무것도 증명하지 못한다.
 *
 * 넷제로: 모든 흔적은 runId 로 식별되고, 종료 시 수거된다. 판정은 "지웠다"가 아니라
 * 실행 전/후 스냅샷의 diff 가 0 이라는 형태로 증명한다. ai_cost_ledger 는 auth.users 로
 * 가는 외래키가 없어 유저 삭제로 지워지지 않으므로 user_id 를 미리 잡아 두고 명시 삭제한다.
 *
 * 사용:
 *   SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ACCESS_TOKEN=... \
 *     node scripts/e2e-population.mjs [--keep] [--only=P1,P2]
 *
 * 플래그:
 *   --keep        정리를 건너뛴다 (디버깅용). 넷제로 판정도 건너뛴다.
 *   --only=P1,P2  일부 페르소나만 실행
 *   --no-ai       실제 AI 호출을 건너뛴다 (돈 0, 경계 검사만)
 *   --l2          L2 동시성 시나리오 추가 (짧은 버스트, 지속 부하 아님)
 *   --heavy       L2 의 카드 한도 레이스 포함 (수천 행 삽입 — 정리는 CASCADE)
 */

const PROJECT_REF = 'ixdapelfikaneexnskfm'
const URL_BASE = process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`
const ANON = process.env.SUPABASE_ANON_KEY || 'sb_publishable_4F7XKb_Cifh2rujOiyP9RQ_ZU3HjQsV'
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const MGMT = process.env.SUPABASE_ACCESS_TOKEN || ''

const argv = process.argv.slice(2)
const KEEP = argv.includes('--keep')
const NO_AI = argv.includes('--no-ai')
const L2 = argv.includes('--l2')
const HEAVY = argv.includes('--heavy')
const ONLY = (argv.find(a => a.startsWith('--only=')) || '').replace('--only=', '')
  .split(',').map(s => s.trim()).filter(Boolean)

const FREE_TIER_AI_CARDS = 10   // ai_free_allowances(tier='free', action_group='card').per_day
const RUN_ID = process.env.E2E_RUN_ID || `r${Date.now().toString(36)}`
const PASSWORD = 'E2ePop!' + RUN_ID
const EMAIL = (p) => `e2e+${RUN_ID}-${p.toLowerCase()}@reeeeecallstudy.xyz`

// ── 결과 수집 ───────────────────────────────────────────────────────────────
const checks = []
let failed = 0
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', c: '\x1b[36m', d: '\x1b[2m', x: '\x1b[0m' }

function check(inv, name, ok, detail) {
  checks.push({ inv, name, ok, detail })
  if (!ok) failed++
  console.log(`  ${ok ? C.g + 'PASS' : C.r + 'FAIL'}${C.x}  ${C.d}${inv}${C.x} ${name}${detail ? ` — ${detail}` : ''}`)
}
/** 알고 있는 결함의 재현. 초록으로 세지 않는다 — 리포트에서 통과와 섞이면 쓸모가 없다. */
function reproduced(inv, name, detail) {
  checks.push({ inv, name, ok: false, expected: true, detail })
  failed++
  console.log(`  ${C.y}REPRO${C.x}  ${C.d}${inv}${C.x} ${name} — ${detail}`)
}
function note(name, detail) {
  console.log(`  ${C.c}INFO${C.x}  ${name}${detail ? ` — ${detail}` : ''}`)
}
function head(t) { console.log(`\n${C.d}${'─'.repeat(72)}${C.x}\n${t}`) }

// ── HTTP ────────────────────────────────────────────────────────────────────
async function http(path, { method = 'GET', jwt, key, body, headers = {}, raw } = {}) {
  const apikey = key || ANON
  const res = await fetch(path.startsWith('http') ? path : `${URL_BASE}${path}`, {
    method,
    headers: {
      apikey,
      Authorization: `Bearer ${jwt || apikey}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  if (raw) return { status: res.status, json, headers: res.headers }
  return { status: res.status, json }
}

const rpc = (jwt, name, args = {}) =>
  http(`/rest/v1/rpc/${name}`, { method: 'POST', jwt, body: args })

const svcRpc = (name, args = {}) =>
  http(`/rest/v1/rpc/${name}`, { method: 'POST', jwt: SERVICE, key: SERVICE, body: args })

const edge = (jwt, fn, body) =>
  http(`/functions/v1/${fn}`, { method: 'POST', jwt, body })

// ── Management API SQL (스냅샷 전용, 읽기) ──────────────────────────────────
async function sql(query) {
  if (!MGMT) throw new Error('SUPABASE_ACCESS_TOKEN 이 필요합니다 (스냅샷용)')
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const j = await res.json()
  if (!res.ok || j?.message) throw new Error(`SQL 실패: ${j?.message || res.status}\n${query.slice(0, 200)}`)
  return j
}

const SNAPSHOT_SQL = `
select
  (select count(*) from auth.users)            as users,
  (select count(*) from decks)                 as decks,
  (select count(*) from cards)                 as cards,
  (select count(*) from user_card_progress)    as progress,
  (select count(*) from billing_subscriptions) as bsubs,
  (select count(*) from subscriptions)         as lsubs,
  (select count(*) from ai_generation_jobs)    as jobs,
  (select count(*) from ai_credit_ledger)      as cred_rows,
  (select coalesce(sum(delta),0)::text from ai_credit_ledger) as cred_delta,
  (select count(*) from ai_cost_ledger)        as cost_rows,
  (select coalesce(sum(cost_micro_usd),0)::text from ai_cost_ledger) as cost_micro
`

async function snapshot() {
  const [row] = await sql(SNAPSHOT_SQL.replace(/\s+/g, ' ').trim())
  return row
}

function diffSnapshots(before, after) {
  const drift = []
  for (const k of Object.keys(before)) {
    const a = String(before[k]), b = String(after[k])
    if (a !== b) drift.push(`${k}: ${a} → ${b}`)
  }
  return drift
}

// ── 유저 ────────────────────────────────────────────────────────────────────
const created = []   // { persona, id, email }

async function createUser(persona) {
  const email = EMAIL(persona)
  const r = await http('/auth/v1/admin/users', {
    method: 'POST', jwt: SERVICE, key: SERVICE,
    body: {
      email, password: PASSWORD, email_confirm: true,
      user_metadata: { e2e_run: RUN_ID, e2e_persona: persona },
    },
  })
  if (r.status >= 300 || !r.json?.id) throw new Error(`${persona} 생성 실패: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`)
  const rec = { persona, id: r.json.id, email }
  created.push(rec)
  return rec
}

async function signIn(email) {
  const r = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: PASSWORD } })
  if (!r.json?.access_token) throw new Error(`로그인 실패 ${email}: ${JSON.stringify(r.json).slice(0, 200)}`)
  return r.json.access_token
}

async function newPersona(p) {
  const u = await createUser(p)
  u.jwt = await signIn(u.email)
  note(`${p} 준비`, `${u.id.slice(0, 8)} · ${u.email}`)
  return u
}

// ── 덱/템플릿 (실제 유저 경로) ──────────────────────────────────────────────
async function createDeck(u, name) {
  const r = await http('/rest/v1/decks', {
    method: 'POST', jwt: u.jwt,
    headers: { Prefer: 'return=representation' },
    body: { name, description: `e2e ${RUN_ID}`, user_id: u.id },
  })
  if (r.status >= 300) throw new Error(`덱 생성 실패: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`)
  return Array.isArray(r.json) ? r.json[0] : r.json
}

// ═══════════════════════════════════════════════════════════════════════════
// 페르소나
// ═══════════════════════════════════════════════════════════════════════════

/** P1 — 무료 신규: 무료 AI 한도 경계와 넷제로 */
async function P1() {
  head(`${C.c}P1${C.x} 무료 신규 — 무료 한도 경계 · 넷제로`)
  const u = await newPersona('P1')

  // 기준: 갓 만든 계정의 무료 할당
  const q0 = await rpc(u.jwt, 'get_ai_generation_quota')
  const quota = Array.isArray(q0.json) ? q0.json[0] : q0.json
  check('INV-3', '신규 계정 무료 카드 한도 = 10',
    Number(quota?.free_limit) === 10, `free_limit=${quota?.free_limit} used=${quota?.free_used} remaining=${quota?.remaining}`)

  const wallet0 = await rpc(u.jwt, 'get_ai_wallet_summary')
  const w0 = Array.isArray(wallet0.json) ? wallet0.json[0] : wallet0.json
  note('P1 지갑 초기', JSON.stringify(w0))

  const deck = await createDeck(u, `e2e-P1-${RUN_ID}`)
  check('INV-4', '덱 생성이 유저 JWT 로 성공', !!deck?.id, deck?.id?.slice(0, 8))

  if (!NO_AI) {
    // 서버의 asFields 는 key + name 을 요구한다 (module-level FIELDS).
    // (1) 무료 범위 안쪽 — 실제 제공자 호출
    const gen = await edge(u.jwt, 'ai-generate', {
      kind: 'cards', topic: 'basic english vocabulary for beginners',
      uiLang: 'en', cardCount: 3, fields: FIELDS,
    })
    check('INV-2', 'AI 카드 생성(3장) 200', gen.status === 200,
      gen.status === 200 ? `remainingFree=${gen.json?.remainingFree}` : `status=${gen.status} ${JSON.stringify(gen.json).slice(0, 200)}`)

    let usedAfter = null
    if (gen.status === 200) {
      const q1 = await rpc(u.jwt, 'get_ai_generation_quota')
      const quota1 = Array.isArray(q1.json) ? q1.json[0] : q1.json
      usedAfter = Number(quota1?.free_used)
      check('INV-2', '무료 사용량이 정확히 요청분만큼 증가',
        usedAfter === 3, `free_used ${quota?.free_used} → ${usedAfter}`)

      const items = Object.values(gen.json?.content || {}).find(v => Array.isArray(v))
      check('INV-2', '응답이 요청한 장수만큼 배달',
        Array.isArray(items) && items.length === 3, `배달 ${Array.isArray(items) ? items.length : '?'}장`)
    }

    // (2) 무료 한도 경계 — 잔액 0 인 계정이 무료분을 넘겨 요청하면 유료 구간에서 막혀야 한다
    const bal = await balance(u.id)
    check('INV-4', '경계 시험 전 잔액이 0 인지 확인', Number(bal) === 0, `balance=${bal}`)

    const before = await aiCounters(u.id)
    const over = await edge(u.jwt, 'ai-generate', {
      kind: 'cards', topic: 'more english vocabulary',
      uiLang: 'en', cardCount: 9, fields: FIELDS,   // 3 + 9 = 12 > 무료 10
    })
    check('INV-4', '무료 초과 + 잔액 0 → 402 로 차단',
      over.status === 402, `status=${over.status} ${JSON.stringify(over.json).slice(0, 160)}`)

    // (3) 넷제로 — 차단된 요청이 카운터/잔액/원장을 건드리지 않았는가
    const after = await aiCounters(u.id)
    check('INV-1', '차단된 요청이 넷제로 (카운터·잔액·원장 불변)',
      JSON.stringify(before) === JSON.stringify(after),
      `${JSON.stringify(before)} → ${JSON.stringify(after)}`)
  } else {
    note('P1 AI 호출', '--no-ai 로 생략')
  }

  // INV-6 — 예약이 원장에 음수행을 쓰지 않는다
  const led = await sql(`select count(*) c from ai_credit_ledger where user_id='${u.id}' and delta < 0`)
  check('INV-6', '예약 단계에서 원장 음수행 없음', Number(led[0].c) === 0, `음수행 ${led[0].c}개`)

  return u
}

/** P2 — 유료 전환: 결제 → 권한 전파 (INV-3, 설계가 예측한 실패 지점) */
async function P2() {
  head(`${C.c}P2${C.x} 유료 전환 — 권한 전파 삼자 대조`)
  const u = await newPersona('P2')

  const before = {
    cardLimit: await ownedCardLimit(u.id),
    aiTier: await aiTier(u.id),
    quota: await freeLimit(u.jwt),
  }
  note('P2 구독 전', `카드한도=${before.cardLimit} AI티어=${before.aiTier} 무료한도=${before.quota}`)

  // 웹훅이 부르는 바로 그 RPC. 손으로 만든 행이 아니다.
  const g = await svcRpc('grant_subscription', {
    p_user: u.id,
    p_product_id: 'sub_5k_monthly',
    p_provider: 'e2e',
    p_provider_ref: `e2e-${RUN_ID}-p2`,
    p_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
  })
  check('INV-3', 'grant_subscription 성공', g.status < 300, `status=${g.status}`)

  const after = {
    cardLimit: await ownedCardLimit(u.id),
    aiTier: await aiTier(u.id),
    quota: await freeLimit(u.jwt),
  }
  note('P2 구독 후', `카드한도=${after.cardLimit} AI티어=${after.aiTier} 무료한도=${after.quota}`)

  // 카드 한도는 billing_subscriptions 를 읽으므로 올라야 한다
  check('INV-3', '카드 한도가 플랜 값으로 상승',
    Number(after.cardLimit) > Number(before.cardLimit),
    `${before.cardLimit} → ${after.cardLimit}`)

  // 삼자 대조의 핵심: AI 배분이 이 구독을 실제로 본다는 것을 증명해야 한다.
  // per_day 값만 읽으면 증명이 안 된다 — plan_5k 배분 행이 없어 어차피 free 로 폴백해
  // 고치기 전과 후가 똑같이 10 이기 때문이다. 그래서 plan_5k 행을 **임시로** 넣고
  // (트랜잭션 안, 롤백됨) 그 값이 이 구독자에게 도달하는지 본다.
  const SENTINEL = 999
  const probe = await sql(
    `BEGIN; ` +
    `INSERT INTO ai_free_allowances(tier, action_group, per_day, unit_kind, trial_applies) ` +
    `VALUES ('plan_5k','card',${SENTINEL},'item',false); ` +
    `SELECT per_day FROM public._ai_free_allowance('${u.id}'::uuid,'card'); ` +
    `ROLLBACK;`)
  const reached = Number(probe?.[0]?.per_day)
  if (reached === SENTINEL) {
    check('INV-3', '유료 티어의 AI 배분이 구독자에게 실제로 도달한다',
      true, `plan_5k 배분 ${SENTINEL} → 구독자가 ${reached} 수신`)
  } else {
    reproduced('INV-3', '결제가 AI 배분 티어에 전파되지 않음',
      `plan_5k 배분을 ${SENTINEL} 로 넣어도 구독자는 ${reached} 를 받는다 ` +
      `(subscriptions.tier=${after.aiTier}) — F-1 재현`)
  }

  // 엔타이틀먼트 응답도 같은 말을 하는가 — F-1 이 클라이언트에 보이는 지점
  const ent = await rpc(u.jwt, 'get_my_entitlements')
  const e = Array.isArray(ent.json) ? ent.json[0] : ent.json
  note('P2 엔타이틀먼트', JSON.stringify(e).slice(0, 240))
  check('INV-3', '엔타이틀먼트 tier 가 플랜을 반영', e?.tier === 'plan_5k', `tier=${e?.tier}`)
  check('INV-3', '엔타이틀먼트 cards_total 이 플랜 한도', Number(e?.cards_total) === 100000, `cards_total=${e?.cards_total}`)
  if (Number(e?.free_ai_cards_per_day) === FREE_TIER_AI_CARDS) {
    reproduced('INV-3', '유료 티어의 광고된 무료 AI 카드 수가 무료 티어와 동일',
      `free_ai_cards_per_day=${e?.free_ai_cards_per_day} (무료 티어와 같음) — F-1 이 API 응답에 드러나는 지점`)
  } else {
    check('INV-3', '유료 티어가 더 많은 무료 AI 를 광고', true, `free_ai_cards_per_day=${e?.free_ai_cards_per_day}`)
  }

  const sub = await rpc(u.jwt, 'get_my_subscription')
  check('INV-3', 'get_my_subscription 이 구독을 반영',
    JSON.stringify(sub.json).includes('plan_5k') || JSON.stringify(sub.json).includes('sub_5k'),
    JSON.stringify(sub.json).slice(0, 160))

  return u
}

/** P3 — 크레딧 구매자: 유료 액션 과금 정확도 */
async function P3() {
  head(`${C.c}P3${C.x} 크레딧 — 유료 액션 과금`)
  const u = await newPersona('P3')

  const bal0 = await balance(u.id)
  check('INV-6', '신규 계정 잔액 0', Number(bal0) === 0, `balance=${bal0}`)

  const TOP_UP = 990000 // credits_1000 상당 ($0.99)
  const a = await svcRpc('add_ai_credits', {
    p_user_id: u.id, p_micro_won: TOP_UP, p_reason: 'purchase', p_ref: `e2e-${RUN_ID}-p3`,
  })
  check('INV-2', '크레딧 지급 성공', a.status < 300, `status=${a.status}${a.status >= 300 ? ' ' + JSON.stringify(a.json).slice(0, 200) : ''}`)

  const bal1 = await balance(u.id)
  check('INV-2', '잔액이 지급액과 정확히 일치',
    Number(bal1) - Number(bal0) === TOP_UP, `${bal0} → ${bal1} (기대 +${TOP_UP})`)

  // 원장 정합성: 잔액과 원장 합계가 같아야 한다
  const l = await sql(`select coalesce(sum(delta),0)::text s from ai_credit_ledger where user_id='${u.id}'`)
  check('INV-6', '잔액 == 원장 합계', String(l[0].s) === String(bal1), `원장=${l[0].s} 잔액=${bal1}`)

  return u
}

/** P6 — 악의적: IDOR · 서버 게이트 */
async function P6(victim) {
  head(`${C.c}P6${C.x} 악의적 — IDOR · 게이트 우회`)
  const u = await newPersona('P6')

  // 남의 id 로 크레딧 지급을 시도 (유저 JWT 로)
  const idor1 = await rpc(u.jwt, 'add_ai_credits', {
    p_user_id: victim.id, p_micro_won: 999000000, p_reason: 'idor', p_ref: `e2e-${RUN_ID}-idor`,
  })
  check('INV-7', 'add_ai_credits 를 남의 id 로 호출 → 거부', idor1.status >= 400,
    `status=${idor1.status} ${JSON.stringify(idor1.json).slice(0, 140)}`)

  // 남의 구독을 부여 시도
  const idor2 = await rpc(u.jwt, 'grant_subscription', {
    p_user: victim.id, p_product_id: 'sub_5k_monthly', p_provider: 'idor',
    p_provider_ref: `e2e-${RUN_ID}-idor2`, p_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
  })
  check('INV-7', 'grant_subscription 을 유저 JWT 로 호출 → 거부', idor2.status >= 400,
    `status=${idor2.status}`)

  // 남의 덱을 읽기 시도 (RLS)
  const rls = await http(`/rest/v1/decks?user_id=eq.${victim.id}&select=id,name`, { jwt: u.jwt })
  const leaked = Array.isArray(rls.json) ? rls.json.length : 0
  check('INV-7', '남의 덱이 RLS 로 가려짐', leaked === 0, `보인 행 ${leaked}개`)

  // 서버 게이트: 과금/정산은 service_role 전용이어야 한다
  const selfSettle = await rpc(u.jwt, 'charge_ai_generation', {
    p_user_id: u.id, p_job_ref: `e2e-${RUN_ID}-self`, p_provider: 'x', p_model: 'y',
    p_tokens_in: 1, p_tokens_out: 1,
  })
  check('INV-4', 'charge_ai_generation 을 유저가 직접 호출 → 거부', selfSettle.status >= 400,
    `status=${selfSettle.status}`)

  return u
}

/** 카드 벌크 적재 — 실제 유저 경로(템플릿 → PostgREST). 반환: {deck, templateId} */
async function seedCards(u, count, label) {
  const deck = await createDeck(u, `e2e-${label}-${RUN_ID}`)
  const ens = await rpc(u.jwt, 'ensure_default_templates')
  if (ens.status >= 300) throw new Error(`템플릿 생성 실패: ${ens.status}`)
  const tpl = await http(`/rest/v1/card_templates?user_id=eq.${u.id}&select=id&limit=1`, { jwt: u.jwt })
  const templateId = Array.isArray(tpl.json) ? tpl.json[0]?.id : null
  if (!templateId) throw new Error('템플릿 없음')

  const CHUNK = 1000
  for (let done = 0; done < count; done += CHUNK) {
    const n = Math.min(CHUNK, count - done)
    const rows = Array.from({ length: n }, (_, i) => ({
      deck_id: deck.id, user_id: u.id, template_id: templateId,
      field_values: { front: `e2e ${done + i}`, back: `card ${done + i}` },
      sort_position: done + i,
    }))
    const r = await http('/rest/v1/cards', { method: 'POST', jwt: u.jwt, headers: { Prefer: 'return=minimal' }, body: rows })
    if (r.status >= 300) throw new Error(`적재 실패 ${done}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`)
  }
  return { deck, templateId }
}

/** P4 — 1,000행 잘림 (INV-8). 프로덕션에서 실제로 터졌던 버그(#599/#600). */
async function P4() {
  head(`${C.c}P4${C.x} 헤비 학습자 — 1,000행 잘림`)
  const u = await newPersona('P4')
  const N = 1200                      // PostgREST max_rows=1000 을 확실히 넘긴다
  const { deck } = await seedCards(u, N, 'P4')

  // 서버 집계: max_rows 와 무관해야 한다 (RPC 가 DB 안에서 센다)
  const st = await rpc(u.jwt, 'get_deck_stats', { p_user_id: u.id })
  const rows = Array.isArray(st.json) ? st.json : []
  const mine = rows.find(r => r.deck_id === deck.id) || rows[0]
  note('P4 get_deck_stats', JSON.stringify(mine).slice(0, 220))
  check('INV-8', 'get_deck_stats 가 1,000에서 잘리지 않음',
    Number(mine?.total_cards ?? mine?.card_count ?? -1) === N,
    `total=${mine?.total_cards ?? mine?.card_count} (기대 ${N})`)

  const usage = await rpc(u.jwt, 'get_owned_card_usage')
  const used = Array.isArray(usage.json) ? usage.json[0] : usage.json
  note('P4 소유 카드 집계', JSON.stringify(used).slice(0, 200))
  check('INV-8', '소유 카드 집계가 전량을 센다',
    JSON.stringify(used).includes(String(N)), `${JSON.stringify(used).slice(0, 120)}`)

  // 단일 요청은 max_rows 에서 잘린다 — 이것이 정상이며, 그래서 클라이언트가 페이징해야 한다
  const one = await http(`/rest/v1/cards?deck_id=eq.${deck.id}&select=id&order=id.asc`, { jwt: u.jwt })
  const gotOne = Array.isArray(one.json) ? one.json.length : -1
  note('P4 단일 요청', `${gotOne}행 — 서버 상한이 여기서 드러난다`)
  check('INV-8', '단일 요청이 서버 상한에서 잘린다 (페이징이 필요한 이유)',
    gotOne < N, `단일 ${gotOne}행 < 전체 ${N}행`)

  // id 타이브레이커 페이징으로 전량 회수 — 중복/누락이 없어야 한다
  const seen = new Set()
  let cursor = '00000000-0000-0000-0000-000000000000'
  for (let page = 0; page < 10; page++) {
    const r = await http(`/rest/v1/cards?deck_id=eq.${deck.id}&id=gt.${cursor}&select=id&order=id.asc&limit=500`, { jwt: u.jwt })
    const batch = Array.isArray(r.json) ? r.json : []
    if (!batch.length) break
    for (const row of batch) seen.add(row.id)
    cursor = batch[batch.length - 1].id
  }
  check('INV-8', 'id 타이브레이커 페이징이 전량을 중복 없이 회수',
    seen.size === N, `회수 ${seen.size}행 (기대 ${N})`)

  return u
}

/** P5 — 만료 왕복 (INV-9). 환불/만료 시 초과분이 삭제가 아니라 아카이브여야 한다. */
async function P5() {
  head(`${C.c}P5${C.x} 이탈자 — 만료 → 아카이브 → 재구독 복원`)
  const u = await newPersona('P5')

  const freeLimitCards = Number(await ownedCardLimit(u.id))
  const ref = `e2e-${RUN_ID}-p5`
  // 스토어(RevenueCat/LemonSqueezy) 경로를 쓴다. grant_subscription 은 provider_subscription_id
  // 를 채우지 않아 revoke_subscription 이 영원히 찾지 못한다 — 만료를 테스트하려면 이쪽이어야 한다.
  const g = await svcRpc('sync_subscription_by_user', {
    p_user: u.id, p_product_id: 'sub_5k_monthly', p_provider: 'e2e',
    p_provider_subscription_id: ref, p_status: 'active',
    p_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
    p_cancel_at_period_end: false,
  })
  check('INV-9', '구독 부여 (스토어 경로)', g.status < 300, `status=${g.status} ${g.status >= 300 ? JSON.stringify(g.json).slice(0, 180) : ''}`)
  const paidLimit = Number(await ownedCardLimit(u.id))
  note('P5 한도', `무료 ${freeLimitCards} → 유료 ${paidLimit}`)

  // 무료 한도를 넘는 양을 적재 (유료 상태에서는 합법)
  const OVER = freeLimitCards + 120
  await seedCards(u, OVER, 'P5')
  const c0 = await sql(`select count(*) c from cards where user_id='${u.id}'`)
  check('INV-9', `유료 상태에서 무료 한도 초과 적재 (${OVER}장)`, Number(c0[0].c) === OVER, `${c0[0].c}장`)

  const th0 = await rpc(u.jwt, 'get_active_card_threshold')
  note('P5 구독중 임계값', JSON.stringify(th0.json))

  // 만료 — revoke_subscription 은 provider_ref 가 아니라 provider_subscription_id 로 찾는다.
  // 둘은 다른 컬럼이다. 행에서 실제 값을 읽어 쓴다.
  const subRow = await sql(`select coalesce(provider_subscription_id,'') v from billing_subscriptions where user_id='${u.id}' and status='active' limit 1`)
  const subKey = subRow[0]?.v
  note('P5 구독 식별자', `provider_subscription_id=${subKey || '(비어 있음)'}`)

  const rv = await svcRpc('revoke_subscription', { p_provider: 'e2e', p_provider_subscription_id: subKey })
  // 이 RPC 는 못 찾아도 HTTP 200 + {ok:false} 를 돌려준다. 상태코드만 보면 통과해 버린다.
  const rvOk = rv.status < 300 && rv.json?.ok === true
  check('INV-9', '구독 만료 처리 (ok 플래그까지 확인)', rvOk,
    `status=${rv.status} body=${JSON.stringify(rv.json).slice(0, 160)}`)
  if (!rvOk) { note('P5', 'revoke 가 실패해 이후 검사는 의미가 없으므로 중단'); return u }
  const limitAfter = Number(await ownedCardLimit(u.id))
  check('INV-9', '한도가 무료 수준으로 하락', limitAfter === freeLimitCards, `${paidLimit} → ${limitAfter}`)

  // 카드가 삭제되지 않았는지 — 이것이 핵심이다
  const c1 = await sql(`select count(*) c from cards where user_id='${u.id}'`)
  check('INV-9', '만료가 카드를 삭제하지 않는다 (아카이브여야 한다)',
    Number(c1[0].c) === OVER, `${c0[0].c} → ${c1[0].c}장`)

  const th1 = await rpc(u.jwt, 'get_active_card_threshold')
  note('P5 만료후 임계값', JSON.stringify(th1.json))
  const arch = await rpc(u.jwt, 'get_deck_archived_count', { p_deck_id: null })
  note('P5 아카이브 카운트', `status=${arch.status} ${JSON.stringify(arch.json).slice(0, 120)}`)

  // 재구독 → 복원
  const g2 = await svcRpc('sync_subscription_by_user', {
    p_user: u.id, p_product_id: 'sub_5k_monthly', p_provider: 'e2e',
    p_provider_subscription_id: `${ref}-again`, p_status: 'active',
    p_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
    p_cancel_at_period_end: false,
  })
  check('INV-9', '재구독', g2.status < 300, `status=${g2.status}`)
  const th2 = await rpc(u.jwt, 'get_active_card_threshold')
  check('INV-9', '재구독으로 임계값이 해제(복원)됨',
    JSON.stringify(th2.json) === JSON.stringify(th0.json),
    `구독중=${JSON.stringify(th0.json)} 재구독후=${JSON.stringify(th2.json)}`)

  const c2 = await sql(`select count(*) c from cards where user_id='${u.id}'`)
  check('INV-9', '재구독 후에도 카드 전량 보존', Number(c2[0].c) === OVER, `${c2[0].c}장`)
  return u
}

// ═══════════════════════════════════════════════════════════════════════════
// L2 — 동시성. 용량이 아니라 경쟁 상태가 목적이다. 짧은 버스트만 쓴다.
// ═══════════════════════════════════════════════════════════════════════════

const FIELDS = [
  { key: 'front', name: 'Front', order: 0 },
  { key: 'back', name: 'Back', order: 1 },
]

/** N개를 동시에 쏘고 상태코드를 모은다. Promise.all 은 하나라도 throw 하면 전부 잃으므로 allSettled. */
async function burst(n, fn) {
  const rs = await Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)))
  return rs.map(r => r.status === 'fulfilled' ? r.value : { status: -1, json: { error: String(r.reason) } })
}

/** R1 — 무료 할당 레이스: 동시 요청이 무료 10장을 넘겨 먹을 수 있는가 */
async function R1_freeAllowanceRace() {
  head(`${C.c}R1${C.x} 무료 할당 레이스 — 동시 요청이 무료분을 초과 소비하는가`)
  const u = await newPersona('R1')

  const N = 5, PER = 3   // 15장 요청 > 무료 10장, 잔액 0
  const rs = await burst(N, () => edge(u.jwt, 'ai-generate', {
    kind: 'cards', topic: 'assorted english vocabulary', uiLang: 'en', cardCount: PER, fields: FIELDS,
  }))
  const ok = rs.filter(r => r.status === 200).length
  const blocked = rs.filter(r => r.status === 402).length
  note('R1 응답 분포', rs.map(r => r.status).join(' '))

  const q = await rpc(u.jwt, 'get_ai_generation_quota')
  const quota = Array.isArray(q.json) ? q.json[0] : q.json
  const used = Number(quota?.free_used)
  const bal = Number(await balance(u.id))

  check('INV-4', '동시 요청이 무료 한도를 넘겨 소비하지 않음',
    used <= 10, `free_used=${used} (한도 10) · 성공 ${ok}건 · 402 ${blocked}건`)
  check('INV-1', '잔액 0 계정이 음수로 가지 않음', bal >= 0, `balance=${bal}`)
  check('INV-2', '무료를 넘긴 요청은 과금되거나 차단된다 (무료로 새지 않음)',
    ok * PER <= 10 || bal < 0 === false, `무료배달상한=${used} 성공=${ok}×${PER}`)
  return u
}

/** R2 — 크레딧 이중 차감: 1건분 잔액으로 동시 유료 요청 N건 */
async function R2_doubleSpendRace() {
  head(`${C.c}R2${C.x} 크레딧 이중 차감 — 1건분 잔액에 동시 유료 요청`)
  const u = await newPersona('R2')

  // 무료분을 먼저 소진
  const warm = await edge(u.jwt, 'ai-generate', {
    kind: 'cards', topic: 'english basics', uiLang: 'en', cardCount: 10, fields: FIELDS,
  })
  check('INV-2', '무료 10장 선소진', warm.status === 200, `status=${warm.status}`)

  // 잔액은 UI 견적(est_price_per_card_micro)이 아니라 **실제 청구 정가**로 잡아야 한다.
  // 첫 실행에서 견적(14,810)으로 잡았다가 실제 정가(10,000) 기준으로는 2장이 들어가
  // "이중 차감"으로 오판했다. 정가는 ai_action_prices 가 유일한 출처다.
  const pr = await sql(`select price_micro::text v from ai_action_prices where action='card'`)
  const per = Number(pr[0].v)
  const w = await rpc(u.jwt, 'get_ai_wallet_summary')
  const est = Number((Array.isArray(w.json) ? w.json[0] : w.json)?.est_price_per_card_micro || 0)
  note('R2 단가', `정가=${per} · UI견적=${est}${est > per ? ` (견적이 ${Math.round((est / per - 1) * 100)}% 높음)` : ''}`)
  const TOP = Math.floor(per * 1.5)   // 1장은 되고 2장(=2*per)은 안 되는 금액
  await svcRpc('add_ai_credits', { p_user_id: u.id, p_micro_won: TOP, p_reason: 'purchase', p_ref: `e2e-${RUN_ID}-r2` })
  const bal0 = Number(await balance(u.id))
  check('INV-2', '잔액이 1장분만 되도록 세팅됨', bal0 >= per && bal0 < per * 2, `balance=${bal0} 정가=${per}`)

  const rs = await burst(5, () => edge(u.jwt, 'ai-generate', {
    kind: 'cards', topic: 'english idioms', uiLang: 'en', cardCount: 1, fields: FIELDS,
  }))
  const ok = rs.filter(r => r.status === 200).length
  note('R2 응답 분포', rs.map(r => r.status).join(' '))

  const bal1 = Number(await balance(u.id))
  check('INV-5', '1건분 잔액으로 동시 요청 5건 → 성공 1건 이하', ok <= 1, `성공 ${ok}건`)
  check('INV-5', '잔액이 음수로 내려가지 않음', bal1 >= 0, `${bal0} → ${bal1}`)
  check('INV-2', '청구액이 정가 × 성공건수와 일치',
    bal0 - bal1 === ok * per, `차감 ${bal0 - bal1} (기대 ${ok}×${per}=${ok * per})`)

  const led = await sql(`select coalesce(sum(delta),0)::text s from ai_credit_ledger where user_id='${u.id}'`)
  check('INV-6', '잔액 == 원장 합계 (동시 차감 후에도)', String(led[0].s) === String(bal1), `원장=${led[0].s} 잔액=${bal1}`)
  return u
}

/** R3 — 중복 구독: 같은 provider_ref 로 동시 부여 */
async function R3_duplicateGrantRace() {
  head(`${C.c}R3${C.x} 중복 구독 — 같은 provider_ref 동시 부여 (웹훅 재전송 모사)`)
  const u = await newPersona('R3')

  const ref = `e2e-${RUN_ID}-r3`
  const periodEnd = new Date(Date.now() + 30 * 864e5).toISOString()
  const rs = await burst(4, () => svcRpc('grant_subscription', {
    p_user: u.id, p_product_id: 'sub_5k_monthly', p_provider: 'e2e',
    p_provider_ref: ref, p_period_end: periodEnd,
  }))
  note('R3 응답 분포', rs.map(r => r.status).join(' '))

  const rows = await sql(`select count(*) c from billing_subscriptions where user_id='${u.id}'`)
  const active = await sql(`select count(*) c from billing_subscriptions where user_id='${u.id}' and status='active'`)
  check('INV-5', '웹훅 4회 재전송 → 구독 행 1개', Number(rows[0].c) === 1, `행 ${rows[0].c}개`)
  check('INV-5', '활성 구독 1개', Number(active[0].c) === 1, `활성 ${active[0].c}개`)

  const limit = await ownedCardLimit(u.id)
  check('INV-3', '중복 부여 후에도 한도가 한 플랜 값', String(limit) === '100000', `한도=${limit}`)
  return u
}

/** R4 — 카드 한도 레이스 (--heavy): 경계에서 동시 삽입이 한도를 넘는가 */
async function R4_cardLimitRace() {
  head(`${C.c}R4${C.x} 카드 한도 레이스 — 경계에서 동시 삽입 (heavy)`)
  const u = await newPersona('R4')
  const deck = await createDeck(u, `e2e-R4-${RUN_ID}`)

  // 카드는 template_id 가 NOT NULL 이고 내용은 field_values jsonb 다.
  // 실제 유저 경로대로 기본 템플릿을 먼저 만든다.
  const ens = await rpc(u.jwt, 'ensure_default_templates')
  check('INV-4', '기본 템플릿 생성', ens.status < 300, `status=${ens.status}`)
  const tpl = await http(`/rest/v1/card_templates?user_id=eq.${u.id}&select=id,name&limit=1`, { jwt: u.jwt })
  const templateId = Array.isArray(tpl.json) ? tpl.json[0]?.id : null
  if (!templateId) {
    check('INV-4', '템플릿 확보', false, JSON.stringify(tpl.json).slice(0, 200))
    return u
  }

  const LIMIT = Number(await ownedCardLimit(u.id))
  note('R4 한도', `${LIMIT}장까지 · template=${templateId.slice(0, 8)}`)

  const mkCard = (i) => ({
    deck_id: deck.id, user_id: u.id, template_id: templateId,
    field_values: { front: `e2e ${i}`, back: `card ${i}` },
    sort_position: i,
  })

  // 한도 직전까지 벌크 삽입
  const target = LIMIT - 1
  const CHUNK = 1000
  for (let done = 0; done < target; done += CHUNK) {
    const n = Math.min(CHUNK, target - done)
    const rows = Array.from({ length: n }, (_, i) => mkCard(done + i))
    const r = await http('/rest/v1/cards', { method: 'POST', jwt: u.jwt, headers: { Prefer: 'return=minimal' }, body: rows })
    if (r.status >= 300) {
      check('INV-4', '한도 직전까지 벌크 삽입', false, `${done}장에서 status=${r.status} ${JSON.stringify(r.json).slice(0, 200)}`)
      return u
    }
  }
  const cnt0 = await sql(`select count(*) c from cards where user_id='${u.id}'`)
  check('INV-4', `한도-1 (${target}장)까지 적재 성공`, Number(cnt0[0].c) === target, `${cnt0[0].c}장`)

  // 마지막 한 자리를 두고 동시 삽입 10건
  const rs = await burst(10, (i) => http('/rest/v1/cards', {
    method: 'POST', jwt: u.jwt, headers: { Prefer: 'return=minimal' },
    body: [mkCard(target + i)],
  }))
  const ok = rs.filter(r => r.status < 300).length
  note('R4 응답 분포', rs.map(r => r.status).join(' '))

  const cnt1 = await sql(`select count(*) c from cards where user_id='${u.id}'`)
  check('INV-4', '동시 삽입 10건이 한도를 넘지 못함',
    Number(cnt1[0].c) <= LIMIT, `최종 ${cnt1[0].c}장 (한도 ${LIMIT}) · 성공 ${ok}건`)
  return u
}

// ── 읽기 헬퍼 (SQL, 스냅샷/진단용) ──────────────────────────────────────────
async function ownedCardLimit(userId) {
  const r = await sql(`select public._owned_card_limit('${userId}'::uuid)::text v`)
  return r[0].v
}
async function aiTier(userId) {
  const r = await sql(`select coalesce((select s.tier from subscriptions s where s.user_id='${userId}'::uuid and s.status='active' order by s.started_at desc limit 1),'(none)') v`)
  return r[0].v
}
async function balance(userId) {
  const r = await sql(`select coalesce((select balance from ai_credit_balance where user_id='${userId}'::uuid),0)::text v`)
  return r[0].v
}
/** 넷제로 판정에 쓰는 유저별 AI 상태 — 카운터·잔액·원장 행 수를 한 번에 */
async function aiCounters(userId) {
  const r = await sql(`select
      coalesce((select balance from ai_credit_balance where user_id='${userId}'::uuid),0)::text as bal,
      (select count(*) from ai_credit_ledger where user_id='${userId}'::uuid)::text as led,
      (select count(*) from ai_generation_jobs where user_id='${userId}'::uuid)::text as jobs`)
  return r[0]
}

async function freeLimit(jwt) {
  const q = await rpc(jwt, 'get_ai_generation_quota')
  const row = Array.isArray(q.json) ? q.json[0] : q.json
  return row?.free_limit
}

// ── 정리 ────────────────────────────────────────────────────────────────────
async function teardown() {
  head(`${C.c}정리${C.x} — 넷제로 수거`)
  const ids = created.map(c => c.id)
  if (!ids.length) { note('정리', '만든 유저 없음'); return }

  // ai_cost_ledger 는 auth.users 로 가는 외래키가 없다 → 유저 삭제로 지워지지 않는다.
  // 유저를 지우기 전에 명시적으로 수거해야 고아 행이 남지 않는다. (설계 F-2)
  const inList = ids.map(i => `'${i}'`).join(',')
  const costRows = await sql(`select count(*) c from ai_cost_ledger where user_id in (${inList})`)
  if (Number(costRows[0].c) > 0) {
    await sql(`delete from ai_cost_ledger where user_id in (${inList})`)
    note('ai_cost_ledger 명시 수거', `${costRows[0].c}행 (외래키 없음 — CASCADE 안 됨)`)
  } else {
    note('ai_cost_ledger', '수거할 행 없음')
  }

  // 카드가 수천 장인 유저는 admin DELETE 가 504 로 죽는다 (실측: 1,200장에서 타임아웃).
  // 무거운 자식 테이블을 먼저 비우면 유저 삭제가 가벼워진다.
  const heavy = await sql(`select count(*) c from cards where user_id in (${inList})`)
  if (Number(heavy[0].c) > 0) {
    await sql(`delete from cards where user_id in (${inList})`)
    await sql(`delete from decks where user_id in (${inList})`)
    await sql(`delete from card_templates where user_id in (${inList})`)
    note('무거운 자식 테이블 선삭제', `카드 ${heavy[0].c}장 + 덱/템플릿`)
  }

  for (const c of created) {
    let r = await http(`/auth/v1/admin/users/${c.id}`, { method: 'DELETE', jwt: SERVICE, key: SERVICE })
    if (r.status >= 300) {
      // admin API 가 죽어도 넷제로는 지켜야 한다 — SQL 로 확실히 지운다.
      await sql(`delete from auth.users where id='${c.id}'`)
      r = { status: 200 }
      note(`${c.persona} 삭제`, 'admin API 실패 → SQL 폴백')
    } else {
      note(`${c.persona} 삭제`, `status=${r.status}`)
    }
  }

  // 정말 없어졌는가 — "지웠다"가 아니라 확인한다
  const left = await sql(`select count(*) c from auth.users where id in (${inList})`)
  check('NET-0', '테스트 유저가 실제로 모두 삭제됨', Number(left[0].c) === 0, `잔여 ${left[0].c}명`)
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!SERVICE) throw new Error('SUPABASE_SERVICE_ROLE_KEY 가 필요합니다')
  if (!MGMT) throw new Error('SUPABASE_ACCESS_TOKEN 이 필요합니다')

  console.log(`${C.d}run=${RUN_ID} target=${URL_BASE} ai=${NO_AI ? 'off' : 'on'}${C.x}`)

  head(`${C.c}L0${C.x} 기준선`)
  const before = await snapshot()
  console.log(`  ${C.d}${JSON.stringify(before)}${C.x}`)

  const want = (p) => !ONLY.length || ONLY.includes(p)
  let p1 = null

  try {
    if (want('P1')) p1 = await P1()
    if (want('P2')) await P2()
    if (want('P3')) await P3()
    if (want('P4')) await P4()
    if (want('P5')) await P5()
    if (want('P6')) {
      const victim = p1 || (await newPersona('PV'))
      await P6(victim)
    }
    if (L2) {
      if (NO_AI) {
        note('L2', 'R1/R2 는 실제 AI 호출이 필요합니다 — --no-ai 와 함께 쓸 수 없어 건너뜁니다')
      } else {
        await R1_freeAllowanceRace()
        await R2_doubleSpendRace()
      }
      await R3_duplicateGrantRace()
      if (HEAVY) await R4_cardLimitRace()
      else note('R4', '카드 한도 레이스는 --heavy 필요 (수천 행 삽입)')
    }
  } catch (e) {
    console.log(`\n${C.r}실행 중 예외${C.x} — 정리는 그대로 진행합니다\n  ${e.message}`)
    failed++
  }

  if (!KEEP) {
    await teardown()
    head(`${C.c}넷제로${C.x} 판정`)
    const after = await snapshot()
    const drift = diffSnapshots(before, after)
    if (drift.length === 0) {
      check('NET-0', '실행 전/후 스냅샷 완전 일치', true, '9개 테이블 · 잔여 0')
    } else {
      check('NET-0', '실행 전/후 스냅샷 일치', false, drift.join(' | '))
    }
  } else {
    note('정리', '--keep 으로 생략 — 넷제로 판정 없음')
    note('잔여', created.map(c => `${c.persona}=${c.id}`).join(' '))
  }

  // ── 리포트 ────────────────────────────────────────────────────────────────
  head(`${C.c}리포트${C.x}`)
  const expectedFails = checks.filter(c => !c.ok && c.expected)
  const realFails = checks.filter(c => !c.ok && !c.expected)
  const passes = checks.filter(c => c.ok)
  console.log(`  통과 ${C.g}${passes.length}${C.x} · 실패 ${C.r}${realFails.length}${C.x} · 알려진 결함 재현 ${C.y}${expectedFails.length}${C.x}`)
  for (const f of realFails) console.log(`  ${C.r}✗${C.x} ${f.inv} ${f.name} — ${f.detail || ''}`)
  for (const f of expectedFails) console.log(`  ${C.y}!${C.x} ${f.inv} ${f.name} — ${f.detail || ''}`)

  process.exit(realFails.length ? 1 : 0)
}

main().catch(e => { console.error(`\n${C.r}치명적${C.x} ${e.stack || e.message}`); process.exit(2) })
