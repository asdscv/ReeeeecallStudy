#!/usr/bin/env node
// 모바일 실사격 스모크 — iOS 시뮬레이터 / Android 에뮬레이터.
//
// 서버가 맞다는 것은 scripts/e2e-population.mjs 가 이미 증명한다. 여기서 보는 것은
// **화면이 서버와 같은 말을 하는가** — 설계의 "표면 간 합의" 사각지대다.
//
// 사용:
//   MOBILE_E2E_EMAIL=... MOBILE_E2E_PASSWORD=... node scripts/mobile/mobile-smoke.mjs ios
//   MOBILE_E2E_EMAIL=... MOBILE_E2E_PASSWORD=... node scripts/mobile/mobile-smoke.mjs android
//
// 준비:
//   APPIUM_HOME=$HOME/.appium appium --port 4723 --base-path /
//   iOS:     npx expo run:ios --device <udid>
//   Android: npx expo run:android   (에뮬레이터를 먼저 부팅해 둘 것)
//
// 초기화(로그아웃 상태로):
//   iOS:     xcrun simctl keychain <udid> reset   ← 세션은 Keychain 에 있다. 데이터
//            컨테이너만 지우면 로그인이 남아 있다.
//   Android: adb shell pm clear com.reeeeecall.study
//            그 다음 debug_http_host 를 10.0.2.2:8081 로 다시 박아야 Metro 에 붙는다.
import fs from 'node:fs'
import { Driver, sel, IOS_CAPS, ANDROID_CAPS } from './appium-drive.mjs'

const PLATFORM = process.argv[2] || 'ios'
const UDID = process.env.IOS_UDID || '73FD94B5-F588-4640-99A7-44D365BB7E3B'  // iPhone 15 Pro
const DIR = process.env.SHOT_DIR || new URL('./shots/', import.meta.url).pathname
fs.mkdirSync(DIR, { recursive: true })

// 계정은 환경변수로 받는다. 저장소에 자격증명을 박지 않는다.
const EMAIL = process.env.MOBILE_E2E_EMAIL
const PASS = process.env.MOBILE_E2E_PASSWORD
if (!EMAIL || !PASS) {
  console.error('MOBILE_E2E_EMAIL / MOBILE_E2E_PASSWORD 가 필요합니다.')
  console.error('일회용 계정을 만들려면 scripts/e2e-population.mjs 의 provision 패턴을 쓰세요.')
  process.exit(2)
}

const C = { g: '\x1b[32m', r: '\x1b[31m', c: '\x1b[36m', d: '\x1b[2m', x: '\x1b[0m' }
let pass = 0, fail = 0
const check = (n, ok, d) => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? C.g + 'PASS' : C.r + 'FAIL'}${C.x}  ${n}${d ? ` — ${d}` : ''}`)
}
const note = (n, d) => console.log(`  ${C.c}INFO${C.x}  ${n}${d ? ` — ${d}` : ''}`)

const isIOS = PLATFORM === 'ios'
const byId = (t) => isIOS ? sel.ios(t) : sel.androidId(t)
const byInput = (t) => isIOS ? sel.ios(t) : sel.androidInput(t)

const d = await Driver.start(isIOS ? IOS_CAPS(UDID) : ANDROID_CAPS())
note('세션 시작', `${PLATFORM} · ${d.id.slice(0, 8)}`)

try {
  // ── 1. 부팅 ────────────────────────────────────────────────────────────
  // #594/#595 계열은 전부 부팅·첫 화면에서 터졌다. 크래시 없이 로그인 화면이
  // 뜨는 것 자체가 검사다.
  // 새 설치의 첫 화면은 AuthGuard(랜딩)다. 로그인 화면은 그 뒤에 있다 —
  // 컴포넌트 주석에도 "이 화면이 iOS E2E 를 막았다"고 적혀 있다.
  const guard = await d.waitFor(...byId('auth-guard-login'), 60000)
  await d.shot(`${DIR}/${PLATFORM}-0-authguard.png`)
  check('앱이 크래시 없이 첫 화면까지 뜬다', !!guard)
  if (guard) { await d.tap(guard); await new Promise(r => setTimeout(r, 1500)) }

  const loginEmail = await d.waitFor(...byInput('login-email-input'), 30000)
  await d.shot(`${DIR}/${PLATFORM}-1-login.png`)
  check('로그인 화면으로 넘어간다', !!loginEmail)
  if (!loginEmail) throw new Error('로그인 화면 도달 실패')

  // ── 2. 로그인 ──────────────────────────────────────────────────────────
  await d.type(loginEmail, EMAIL)
  const pw = await d.waitFor(...byInput('login-password-input'), 10000)
  await d.type(pw, PASS)
  if (!isIOS) await d.hideKeyboard()
  const submit = await d.waitFor(...byId('login-submit-button'), 10000)
  await d.tap(submit)
  note('로그인 제출', EMAIL)

  // 로그인 성공 = 로그인 화면이 사라진다
  let gone = false
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 1000))
    const still = await d.find(...byInput('login-email-input'))
    if (!still) { gone = true; break }
  }
  await d.shot(`${DIR}/${PLATFORM}-2-after-login.png`)
  check('로그인이 통과하고 앱 안으로 들어간다', gone)

  // ── 3. 첫 화면이 실제로 렌더된다 ────────────────────────────────────────
  // 스켈레톤이 떠 있는 동안 찍으면 아래 검사들이 공허하게 통과한다. 실제 콘텐츠가
  // 그려질 때까지 기다린다 — Android 첫 실행에서 정확히 그 상태를 찍었다.
  // 신규 계정은 6단계 환영 투어가 대시보드를 덮는다. UiAutomator2 는 화면에 보이는
  // 노드만 보므로(XCUITest 와 달리) 모달을 닫기 전에는 뒤쪽 요소를 찾지 못한다 —
  // Android 에서 정확히 이것 때문에 "스켈레톤"으로 오판했다.
  const skip = await d.waitFor(...byId('onboarding-skip'), 20000)
  if (skip) { await d.tap(skip); note('환영 투어', '건너뜀'); await new Promise(r => setTimeout(r, 1500)) }
  else note('환영 투어', '없음')

  const quick = await d.waitFor(...byId('dashboard-quick-study'), 45000)
  check('대시보드가 스켈레톤을 벗고 실제 콘텐츠를 그린다', !!quick)
  await new Promise(r => setTimeout(r, 1500))

  const src = await d.source()
  const hasError = /Unable to load script|red ?box|Application error|Something went wrong/i.test(src)
  check('첫 화면에 에러 화면이 없다', !hasError)
  note('화면 트리 크기', `${src.length} chars`)

  // ── 4. 서버가 말하는 값과 화면이 같은 말을 하는가 ───────────────────────
  // 신규 계정이므로 카드 0, 무료 티어. 화면에 유료 문구가 떠 있으면 안 된다.
  const looksPaid = /plan_5k|Pro 플랜|무제한/i.test(src)
  check('무료 계정 화면에 유료 상태가 표시되지 않는다', !looksPaid)

  await d.shot(`${DIR}/${PLATFORM}-3-home.png`)
  note('스크린샷', `${DIR}/${PLATFORM}-*.png`)

} catch (e) {
  fail++
  console.log(`  ${C.r}ERROR${C.x} ${e.message}`)
  try { await d.shot(`${DIR}/${PLATFORM}-error.png`) } catch { /* 무시 */ }
} finally {
  await d.quit()
}

console.log(`\n  ${PLATFORM}: 통과 ${C.g}${pass}${C.x} · 실패 ${C.r}${fail}${C.x}`)
process.exit(fail ? 1 : 0)
