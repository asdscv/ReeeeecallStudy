#!/usr/bin/env node
// 웹 실사격 스모크 — 실제 배포된 프로덕션 웹.
//
// 서버가 맞다는 것은 scripts/e2e-population.mjs 가 증명한다. 여기서 보는 것은
// **브라우저가 그 값을 실제로 보여주는가** — 설계의 "표면 간 합의" 중 웹 절반이다.
// 모바일 절반은 scripts/mobile/mobile-smoke.mjs.
//
// 웹을 따로 보는 이유: 결제가 실제로 일어나는 곳이고(LemonSqueezy),
// `VITE_PAYMENTS_ENABLED=true` 로 이미 켜져 있다.
//
// 사용:
//   WEB_E2E_EMAIL=... WEB_E2E_PASSWORD=... node scripts/web/web-smoke.mjs
//   WEB_URL=https://reeeeecallstudy.xyz  (기본값)
//   EXPECT_CARD_LIMIT=5000               (서버가 말하는 한도. 화면과 대조한다)

import { chromium } from 'playwright'
import fs from 'node:fs'

const SITE = process.env.WEB_URL || 'https://reeeeecallstudy.xyz'
const EMAIL = process.env.WEB_E2E_EMAIL
const PASS = process.env.WEB_E2E_PASSWORD
const EXPECT_LIMIT = process.env.EXPECT_CARD_LIMIT || '5000'
const DIR = process.env.SHOT_DIR || new URL('./shots/', import.meta.url).pathname
fs.mkdirSync(DIR, { recursive: true })

if (!EMAIL || !PASS) {
  console.error('WEB_E2E_EMAIL / WEB_E2E_PASSWORD 가 필요합니다.')
  process.exit(2)
}

const C = { g: '\x1b[32m', r: '\x1b[31m', c: '\x1b[36m', d: '\x1b[2m', x: '\x1b[0m' }
let pass = 0, fail = 0
const check = (n, ok, d) => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? C.g + 'PASS' : C.r + 'FAIL'}${C.x}  ${n}${d ? ` — ${d}` : ''}`)
}
const note = (n, d) => console.log(`  ${C.c}INFO${C.x}  ${n}${d ? ` — ${d}` : ''}`)

// 콘솔 에러는 화면이 멀쩡해 보여도 잡힌다 — 조용히 죽은 위젯을 찾는 유일한 방법이다.
const consoleErrors = []

const browser = await chromium.launch({ channel: 'chrome', headless: true })
// 기본 UA 는 `HeadlessChrome` 이고, 사이트의 봇 처리가 그것을 보고 **404 를 돌려준다**.
// 처음엔 이것을 "딥링크가 전부 깨졌다"는 프로덕션 결함으로 읽었다 — 실제 사용자는 멀쩡하다.
// 일반 Chrome UA 로 바꾸면 200 이다. 웹 E2E 는 반드시 UA 를 지정해야 한다.
const REAL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 }, locale: 'ko-KR', userAgent: REAL_UA,
})
const page = await ctx.newPage()
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })
page.on('pageerror', e => consoleErrors.push('pageerror: ' + String(e.message).slice(0, 200)))

try {
  // ── 1. 배포된 사이트가 뜬다 ─────────────────────────────────────────────
  const resp = await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 45000 })
  check('프로덕션 웹이 200 으로 응답', resp?.status() === 200, `status=${resp?.status()}`)
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.screenshot({ path: `${DIR}/web-1-landing.png`, fullPage: false })

  // ── 2. 로그인 ───────────────────────────────────────────────────────────
  // 라우트는 `/login` 이 아니라 `/auth/login` 이다 (App.tsx). 랜딩의 버튼 문구는
  // 바뀔 수 있으므로 경로를 직접 연다.
  await page.goto(`${SITE}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  // 프리렌더된 셸이 먼저 오고 SPA 가 하이드레이트한 뒤에야 폼이 그려진다.
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  const emailInput = page.locator('input[type="email"]').first()
  const reached = await emailInput.waitFor({ timeout: 45000 }).then(() => true).catch(() => false)
  check('로그인 화면이 렌더된다 (SPA 하이드레이션 포함)', reached)
  if (!reached) throw new Error('로그인 폼이 끝내 그려지지 않음')

  await emailInput.fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(PASS)
  await page.locator('button[type="submit"]').first().click()

  // 로그인 성공 = 비밀번호 입력칸이 사라진다
  let loggedIn = false
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1000)
    if (await page.locator('input[type="password"]').count() === 0) { loggedIn = true; break }
  }
  await page.screenshot({ path: `${DIR}/web-2-after-login.png`, fullPage: false })
  check('로그인이 통과하고 앱 안으로 들어간다', loggedIn)
  if (!loggedIn) throw new Error('로그인 실패')

  // ── 3. 화면이 실제로 그려진다 ───────────────────────────────────────────
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2500)
  const body = (await page.locator('body').innerText().catch(() => '')) || ''
  note('본문 길이', `${body.length} chars`)
  check('빈 화면이 아니다', body.length > 300, `${body.length} chars`)

  const errorish = /Application error|Something went wrong|ChunkLoadError|Failed to fetch/i.test(body)
  check('에러 화면이 아니다', !errorish)

  // ── 4. 표면 간 합의 — 화면의 한도가 서버가 말하는 값과 같은가 ───────────
  // 천단위 구분이 들어가므로 양쪽 표기를 모두 허용한다.
  const withComma = Number(EXPECT_LIMIT).toLocaleString('en-US')
  const limitShown = body.includes(withComma) || body.includes(EXPECT_LIMIT)
  check(`카드 한도 ${withComma} 이 화면에 나타난다`, limitShown,
    limitShown ? '서버 값과 일치' : `본문에서 ${withComma}/${EXPECT_LIMIT} 를 찾지 못함`)

  await page.screenshot({ path: `${DIR}/web-3-dashboard.png`, fullPage: true })

  // ── 5. 결제 표면이 살아 있는가 (VITE_PAYMENTS_ENABLED=true) ─────────────
  // 구독 섹션은 **대시보드가 아니라 설정**에 있다. 대시보드에서 찾다가 없다고 실패로
  // 보고할 뻔했다 — 화면 위치를 확인하지 않고 문자열만 찾으면 그렇게 된다.
  await page.goto(`${SITE}/settings`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2500)
  const settings = (await page.locator('body').innerText().catch(() => '')) || ''
  note('설정 본문 길이', `${settings.length} chars`)

  const hasBilling = /구독|Subscription|플랜|Plan|업그레이드|Upgrade|Standard/i.test(settings)
  check('설정에 구독/결제 표면이 렌더된다', hasBilling,
    hasBilling ? '' : settings.slice(0, 140).replace(/\n/g, ' / '))
  await page.screenshot({ path: `${DIR}/web-4-settings.png`, fullPage: true })

  // ── 6. 조용히 죽은 것이 없는가 ──────────────────────────────────────────
  // 콘솔 에러는 화면이 멀쩡해 보여도 남는다. 알려진 무해한 잡음은 걸러낸다.
  const real = consoleErrors.filter(e =>
    !/favicon|manifest\.json|third-party cookie|Download the React DevTools/i.test(e))
  check('콘솔 에러 없음', real.length === 0,
    real.length ? real.slice(0, 3).join(' || ') : '0건')

  note('스크린샷', `${DIR}/web-*.png`)
} catch (e) {
  fail++
  console.log(`  ${C.r}ERROR${C.x} ${e.message}`)
  await page.screenshot({ path: `${DIR}/web-error.png` }).catch(() => {})
} finally {
  await browser.close()
}

console.log(`\n  web: 통과 ${C.g}${pass}${C.x} · 실패 ${C.r}${fail}${C.x}`)
process.exit(fail ? 1 : 0)
