// Usage: IOS_UDID=<sim udid> node scripts/uiux-audit/mobile-audit.mjs <ios|android> <label>
// Needs Appium on :4723 (APPIUM_HOME=~/.appium appium --base-path /) and the dev build loaded from
// Metro with packages/mobile/.env pointing at the local stack. Counts taps from the dashboard to
// each destination and the tappable elements under the platform minimum (44pt / 48dp).
// Raw W3C Appium client (webdriverio breaks on node 26). LOCAL dev build + LOCAL Supabase test account.
import http from 'node:http'
import fs from 'node:fs'
const [platform, label = 'run'] = process.argv.slice(2)
const IOS = platform === 'ios'
const env = Object.fromEntries(fs.readFileSync(new URL('./local.env', import.meta.url), 'utf8').trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)))
const outDir = new URL(`./out/shots/${label}/`, import.meta.url)
fs.mkdirSync(outDir, { recursive: true })
const DENSITY = 2.625 // pixel_7, 420dpi
const MIN = IOS ? 44 : 48 // Apple HIG pt / Material dp

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined
    const r = http.request({ host: '127.0.0.1', port: 4723, method, path, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let buf = ''
      res.on('data', (c) => (buf += c))
      res.on('end', () => { try { resolve(JSON.parse(buf)) } catch { resolve(buf) } })
    })
    r.on('error', reject)
    if (data) r.write(data)
    r.end()
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let SID
const s = (p) => `/session/${SID}${p}`
const elId = (v) => v && (v.ELEMENT || v['element-6066-11e4-a52f-4a1d6cbf6a1f'])
async function find(id, timeout = 8000) {
  const using = IOS ? 'accessibility id' : '-android uiautomator'
  const value = IOS ? id : `new UiSelector().resourceId("${id}")`
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const r = await req('POST', s('/element'), { using, value })
    const e = elId(r.value)
    if (e) return e
    await sleep(400)
  }
  return null
}
async function findInput(id) {
  if (IOS) return find(id)
  const r = await req('POST', s('/element'), { using: '-android uiautomator', value: `new UiSelector().className("android.widget.EditText").resourceId("${id}")` })
  return elId(r.value) || find(id)
}
async function tapId(id, timeout) {
  const e = await find(id, timeout)
  if (!e) return false
  await req('POST', s(`/element/${e}/click`), {})
  return true
}
async function shot(name) {
  const r = await req('GET', s('/screenshot'))
  if (r.value) fs.writeFileSync(new URL(`${platform}-${name}.png`, outDir), Buffer.from(r.value, 'base64'))
}
async function source() { return String((await req('GET', s('/source'))).value || '') }

/** Every tappable thing on screen and how many are under the platform minimum. */
function targets(src) {
  const out = []
  if (IOS) {
    for (const m of src.matchAll(/<XCUIElementType(Button|Other|Cell|Switch|TextField|SecureTextField|Link)\b[^>]*?>/g)) {
      const tag = m[0]
      if (!/accessible="true"/.test(tag) || !/visible="true"/.test(tag)) continue
      if (m[1] === 'Other' && !/traits="[^"]*Button/.test(tag)) continue
      const w = Number((tag.match(/ width="(\d+)"/) || [])[1]); const h = Number((tag.match(/ height="(\d+)"/) || [])[1])
      const name = (tag.match(/ name="([^"]*)"/) || [])[1] || ''
      if (w && h) out.push({ name: name.slice(0, 28), w, h })
    }
  } else {
    for (const m of src.matchAll(/<[^>]*clickable="true"[^>]*>/g)) {
      const tag = m[0]
      const b = (tag.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) || []).slice(1).map(Number)
      if (b.length < 4) continue
      const w = Math.round((b[2] - b[0]) / DENSITY); const h = Math.round((b[3] - b[1]) / DENSITY)
      const name = (tag.match(/resource-id="([^"]*)"/) || [])[1] || (tag.match(/content-desc="([^"]*)"/) || [])[1] || (tag.match(/ text="([^"]*)"/) || [])[1] || ''
      if (w && h) out.push({ name: name.slice(0, 28), w, h })
    }
  }
  const small = out.filter((t) => t.w < MIN || t.h < MIN)
  return { count: out.length, under: small.length, samples: small.slice(0, 8).map((t) => `${t.name} ${t.w}x${t.h}`) }
}

// ── session ──
const caps = IOS
  ? { platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': process.env.IOS_UDID, 'appium:bundleId': 'com.reeeeecall.study', 'appium:noReset': true, 'appium:newCommandTimeout': 1800, 'appium:wdaLaunchTimeout': 240000 }
  : { platformName: 'Android', 'appium:automationName': 'UiAutomator2', 'appium:udid': 'emulator-5554', 'appium:appPackage': 'com.reeeeecall.study', 'appium:appActivity': '.MainActivity', 'appium:noReset': true, 'appium:newCommandTimeout': 1800, 'appium:uiautomator2ServerLaunchTimeout': 180000, 'appium:uiautomator2ServerInstallTimeout': 180000 }
const created = await req('POST', '/session', { capabilities: { alwaysMatch: caps } })
SID = created.value && created.value.sessionId
if (!SID) { console.log(JSON.stringify(created).slice(0, 600)); process.exit(1) }
fs.writeFileSync(new URL(`./out/${platform}.sid`, import.meta.url), SID)
await req('POST', s('/alert/accept'), {}).catch(() => {})

// ── login (skipped when already signed in) ──
// The app restores the last screen on launch; go home first if the tab bar is there.
await tapId('tab-home', 15000)
if (!(await find('dashboard-screen', 10000))) {
  await tapId('auth-guard-login', 5000)
  const email = await findInput('login-email-input')
  if (!email) { await shot('login-missing'); console.log('login screen not found'); process.exit(2) }
  await req('POST', s(`/element/${email}/value`), { text: env.LOCAL_TEST_EMAIL })
  const pw = await findInput('login-password-input')
  await req('POST', s(`/element/${pw}/value`), { text: env.LOCAL_TEST_PASSWORD })
  if (!IOS) await req('POST', s('/appium/device/hide_keyboard'), {}).catch(() => {})
  await tapId('login-submit-button')
  if (!(await find('dashboard-screen', 30000))) { await shot('login-failed'); console.log('dashboard not reached'); process.exit(3) }
}
await sleep(2500)
await req('POST', s('/alert/dismiss'), {}).catch(() => {})

// ── destinations: the taps it takes from the dashboard, and what is on each screen ──
// Each step is a testID to tap; `ifMissing` steps are only tapped when their child is not yet visible
// (drawer groups keep their open state between visits).
// Each destination is the sequence of testIDs a person taps from the dashboard.
const LAYOUT = process.env.LAYOUT || 'v2'
const DEST_V1 = [
  { name: 'dashboard', steps: [] },
  { name: 'quick-study', steps: ['screen-header-menu', 'drawer-quick-study'] },
  { name: 'brain', steps: ['screen-header-menu', 'drawer-brain'] },
  { name: 'ai-hub', steps: ['screen-header-menu', 'drawer-study-group', 'drawer-ai-hub'] },
  { name: 'decks', steps: ['screen-header-menu', 'drawer-study-group', 'drawer-decks-section', 'drawer-decks'] },
  { name: 'templates', steps: ['screen-header-menu', 'drawer-study-group', 'drawer-decks-section', 'drawer-cards'] },
  { name: 'marketplace', steps: ['screen-header-menu', 'drawer-study-group', 'drawer-explore-section', 'drawer-marketplace'] },
  { name: 'history', steps: ['screen-header-menu', 'drawer-study-group', 'drawer-records-section', 'drawer-history'] },
  { name: 'achievements', steps: ['screen-header-menu', 'drawer-study-group', 'drawer-records-section', 'drawer-achievements'] },
  { name: 'settings', steps: ['screen-header-menu', 'drawer-settings'] },
]
const DEST_V2 = [
  { name: 'dashboard', steps: [] },
  { name: 'quick-study', steps: ['tab-study'] },
  { name: 'brain', steps: ['tab-brain'] },
  { name: 'decks', steps: ['tab-decks'] },
  { name: 'ai-hub', steps: ['tab-more', 'drawer-ai-hub'] },
  { name: 'templates', steps: ['tab-more', 'drawer-cards'] },
  { name: 'marketplace', steps: ['tab-more', 'drawer-marketplace'] },
  { name: 'history', steps: ['tab-more', 'drawer-history'] },
  { name: 'achievements', steps: ['tab-more', 'drawer-achievements'] },
  { name: 'settings', steps: ['tab-more', 'drawer-settings'] },
]
const DEST = LAYOUT === 'v1' ? DEST_V1 : DEST_V2
const results = []
for (const d of DEST) {
  // Start every destination from the dashboard, the way a person would.
  if (d.steps.length && LAYOUT === 'v2') { await tapId('tab-home', 4000); await sleep(800) }
  for (const step of d.steps) {
    if (!IOS && step.startsWith('drawer-')) {
      await req('POST', s('/element'), { using: '-android uiautomator', value: `new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("${step}"))` })
    }
    await tapId(step, 6000)
    await sleep(700)
  }
  await sleep(1800)
  const src = await source()
  const t = targets(src)
  await shot(d.name)
  results.push({ platform, screen: d.name, tapsFromHome: d.steps.length, ...t })
  process.stdout.write('.')
}

// The brain game itself, one trial in.
if (LAYOUT === 'v2') { await tapId('tab-brain', 6000) } else { await tapId('screen-header-menu', 6000); await sleep(600); await tapId('drawer-brain') }
await sleep(1500)
if (await tapId('brain-game-schulte', 5000)) {
  await sleep(1500)
  const t = targets(await source())
  await shot('brain-play')
  results.push({ platform, screen: 'brain-play', tapsFromHome: 3, ...t })
}
fs.writeFileSync(new URL(`./out/mobile-${platform}-${label}.json`, import.meta.url), JSON.stringify(results, null, 1))
console.log(`\n${results.length} screens → scripts/uiux-audit/out/mobile-${platform}-${label}.json`)
