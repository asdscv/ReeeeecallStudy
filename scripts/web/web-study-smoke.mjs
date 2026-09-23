#!/usr/bin/env node
// 웹 학습 플로 — INV-10 의 나머지 절반(클라이언트 캐시 무효화).
//
// API 스위트(P7)는 서버가 SRS 를 기록하고 `srs_revision` 을 올린다는 것까지 증명한다.
// 여기서 보는 것은 **학습을 마친 뒤 내 화면이 실제로 갱신되는가**다. 이것이 안 되면
// "방금 푼 카드가 또 나오는" 증상이 된다 — PR #294 에서 실제로 고쳤던 버그다.
//
// 판정의 핵심: 세션 종료 후 **클라이언트 측 이동**으로 덱을 다시 열었을 때 값이 바뀌어
// 있어야 한다. 하드 리로드로 확인하면 캐시를 우회해버려 아무것도 증명하지 못한다.
//
// 사용:
//   WEB_E2E_EMAIL=... WEB_E2E_PASSWORD=... node scripts/web/web-study-smoke.mjs

import { chromium } from 'playwright'
import fs from 'node:fs'

const SITE = process.env.WEB_URL || 'https://reeeeecallstudy.xyz'
const API = process.env.SUPABASE_URL || 'https://ixdapelfikaneexnskfm.supabase.co'
const ANON = process.env.SUPABASE_ANON_KEY || 'sb_publishable_4F7XKb_Cifh2rujOiyP9RQ_ZU3HjQsV'
const EMAIL = process.env.WEB_E2E_EMAIL
const PASS = process.env.WEB_E2E_PASSWORD
const DIR = process.env.SHOT_DIR || new URL('./shots/', import.meta.url).pathname
fs.mkdirSync(DIR, { recursive: true })

if (!EMAIL || !PASS) { console.error('WEB_E2E_EMAIL / WEB_E2E_PASSWORD 가 필요합니다.'); process.exit(2) }

const C = { g: '\x1b[32m', r: '\x1b[31m', c: '\x1b[36m', d: '\x1b[2m', x: '\x1b[0m' }
let pass = 0, fail = 0
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? C.g + 'PASS' : C.r + 'FAIL'}${C.x}  ${n}${d ? ` — ${d}` : ''}`) }
const note = (n, d) => console.log(`  ${C.c}INFO${C.x}  ${n}${d ? ` — ${d}` : ''}`)

// ── 시딩: 실제 유저 JWT 로 덱+카드를 만든다 ────────────────────────────────
async function rest(path, { method = 'GET', jwt, body, prefer } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const t = await r.text()
  let j = null; try { j = t ? JSON.parse(t) : null } catch { j = t }
  return { status: r.status, json: j }
}

const tok = await fetch(`${API}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASS }),
}).then(r => r.json())
const JWT = tok.access_token
const UID = tok.user?.id
if (!JWT) { console.error('로그인 실패:', JSON.stringify(tok).slice(0, 200)); process.exit(2) }

const TAG = 'webstudy-' + Date.now().toString(36)
const deckRes = await rest('/rest/v1/decks', {
  method: 'POST', jwt: JWT, prefer: 'return=representation',
  body: { name: TAG, description: 'web study smoke', user_id: UID },
})
const deck = Array.isArray(deckRes.json) ? deckRes.json[0] : deckRes.json
check('덱 시딩', !!deck?.id, deck?.id?.slice(0, 8))

await rest('/rest/v1/rpc/ensure_default_templates', { method: 'POST', jwt: JWT, body: {} })
const tpl = await rest(`/rest/v1/card_templates?user_id=eq.${UID}&select=id&limit=1`, { jwt: JWT })
const templateId = Array.isArray(tpl.json) ? tpl.json[0]?.id : null

const CARDS = 3
await rest('/rest/v1/cards', {
  method: 'POST', jwt: JWT, prefer: 'return=minimal',
  body: Array.from({ length: CARDS }, (_, i) => ({
    deck_id: deck.id, user_id: UID, template_id: templateId,
    field_values: { front: `앞면 ${i}`, back: `뒷면 ${i}` }, sort_position: i,
  })),
})
const seeded = await rest(`/rest/v1/cards?deck_id=eq.${deck.id}&select=id,srs_status`, { jwt: JWT })
check(`카드 ${CARDS}장 시딩 (전부 new)`,
  Array.isArray(seeded.json) && seeded.json.length === CARDS && seeded.json.every(c => c.srs_status === 'new'),
  `${seeded.json?.length}장`)

// ── 브라우저 ────────────────────────────────────────────────────────────────
const REAL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', userAgent: REAL_UA })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', e => errs.push(String(e.message).slice(0, 160)))

try {
  await page.goto(`${SITE}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.locator('input[type="email"]').first().waitFor({ timeout: 45000 })
  await page.locator('input[type="email"]').first().fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(PASS)
  await page.locator('button[type="submit"]').first().click()
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1000)
    if (await page.locator('input[type="password"]').count() === 0) break
  }
  check('로그인', await page.locator('input[type="password"]').count() === 0)

  // ── 학습 전 상태를 화면에서 읽는다 ──────────────────────────────────────
  await page.goto(`${SITE}/decks/${deck.id}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2000)
  const before = (await page.locator('body').innerText().catch(() => '')) || ''
  await page.screenshot({ path: `${DIR}/study-1-before.png`, fullPage: true })
  note('학습 전 덱 화면', `${before.length} chars`)

  // ── 학습 ────────────────────────────────────────────────────────────────
  await page.goto(`${SITE}/decks/${deck.id}/study`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(3000)
  await page.screenshot({ path: `${DIR}/study-2-session.png`, fullPage: false })

  // 답 보기 → 평가. 문구는 ko 로케일 기준(다시/어려움/좋음/쉬움).
  const body2 = (await page.locator('body').innerText().catch(() => '')) || ''
  note('학습 화면', body2.slice(0, 110).replace(/\n/g, ' / '))

  // 평가 버튼의 접근 가능 이름은 "좋음" 이 아니라 **"좋음\n10분"** 이다 — 예상 간격이
  // 함께 들어간다. `exact: true` 로 찾다가 두 번 헛발질했고, 그 동안 카드는 멀쩡히
  // 뒤집히고 있었다. 부분 일치로 찾는다.
  const GOOD = /좋음/
  let rated = 0
  for (let n = 0; n < CARDS; n++) {
    if (!(await page.getByRole('button', { name: GOOD }).count())) {
      // 카드 본문을 클릭해 뒤집는다 (뷰포트 중앙 부근이 카드다).
      await page.locator('body').click({ position: { x: 720, y: 470 } }).catch(() => {})
      await page.waitForTimeout(1600)
    }
    const good = page.getByRole('button', { name: GOOD })
    if (!(await good.count())) { note('평가 버튼 없음', `${n + 1}번째에서 중단`); break }
    await good.first().click().catch(() => {})
    rated++
    await page.waitForTimeout(2000)
  }

  check('학습 화면에서 카드를 평가했다', rated > 0, `${rated}장 평가`)
  await page.screenshot({ path: `${DIR}/study-3-rated.png`, fullPage: false })

  // 서버에 실제로 기록됐는가 (여기까지는 P7 이 이미 보증하지만, UI 경로로도 확인)
  const after = await rest(`/rest/v1/cards?deck_id=eq.${deck.id}&select=id,srs_status,srs_revision`, { jwt: JWT })
  const moved = (after.json || []).filter(c => c.srs_status !== 'new').length
  check('UI 학습이 서버 SRS 를 실제로 바꿨다', moved === rated, `new 를 벗어난 카드 ${moved} / 평가 ${rated}`)

  // ── 판정: 클라이언트 이동으로 덱을 다시 열면 값이 갱신돼 있는가 ─────────
  // 하드 리로드가 아니라 SPA 내부 이동이어야 캐시 무효화를 검증한다.
  await page.evaluate((id) => { window.history.pushState({}, '', `/decks/${id}`); window.dispatchEvent(new PopStateEvent('popstate')) }, deck.id)
  await page.waitForTimeout(3500)
  const afterText = (await page.locator('body').innerText().catch(() => '')) || ''
  await page.screenshot({ path: `${DIR}/study-4-after.png`, fullPage: true })

  check('세션 후 덱 화면이 갱신됐다 (캐시 무효화)', afterText !== before,
    afterText === before ? '학습 전과 동일한 화면 — 캐시가 낡았을 수 있다' : '화면 내용이 바뀜')

  check('페이지 예외 없음', errs.length === 0, errs.slice(0, 2).join(' || ') || '0건')
  note('스크린샷', `${DIR}/study-*.png`)
} catch (e) {
  fail++
  console.log(`  ${C.r}ERROR${C.x} ${e.message}`)
  await page.screenshot({ path: `${DIR}/study-error.png` }).catch(() => {})
} finally {
  await browser.close()
  // 넷제로: 덱을 지우면 카드는 CASCADE 로 따라간다.
  const del = await rest(`/rest/v1/decks?id=eq.${deck.id}`, { method: 'DELETE', jwt: JWT })
  const left = await rest(`/rest/v1/cards?deck_id=eq.${deck.id}&select=id`, { jwt: JWT })
  check('정리 — 시딩한 덱/카드 제거', del.status < 300 && (left.json || []).length === 0,
    `delete=${del.status} 잔여카드=${(left.json || []).length}`)
}

console.log(`\n  web-study: 통과 ${C.g}${pass}${C.x} · 실패 ${C.r}${fail}${C.x}`)
process.exit(fail ? 1 : 0)
