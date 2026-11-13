// Usage: node scripts/uiux-audit/web-audit.mjs <label>
// Measures every route at desktop + phone widths, light + dark, against the LOCAL dev server (5192)
// signed in as the LOCAL Supabase test account from setup-local.sh. Output: out/web-<label>.json
// and out/shots/<label>/*.png — compare two labels with compare.mjs.
import { chromium } from '../../node_modules/playwright/index.mjs'
import fs from 'node:fs'
const label = process.argv[2] || 'run'
const BASE = 'http://localhost:5192'
const env = Object.fromEntries(fs.readFileSync(new URL('./local.env', import.meta.url), 'utf8').trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)))
const DECK = env.DECK
const ROUTES = ['/dashboard', '/quick-study', '/brain', '/brain/play/memoryGrid', '/brain/play/stroop', '/decks', `/decks/${DECK}`, '/learning', '/quiz', '/ai', '/marketplace', '/history', '/achievements', '/settings', '/templates', '/guide']
const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
]
const outDir = new URL(`./out/shots/${label}/`, import.meta.url)
fs.mkdirSync(outDir, { recursive: true })
// Vite serves files outside the app root at /@fs/<absolute path>.
const PROBE = `/@fs${new URL('./probe.mjs', import.meta.url).pathname}`
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results = []
for (const vp of VIEWPORTS) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ ...vp, colorScheme: scheme, locale: 'ko-KR' })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/auth/login?lang=ko`)
    await page.fill('input[type=email]', env.LOCAL_TEST_EMAIL)
    await page.fill('input[type=password]', env.LOCAL_TEST_PASSWORD)
    await page.click('button[type=submit]')
    await page.waitForURL('**/dashboard', { timeout: 20000 })
    // The app's own theme setting, so dark really is dark (data-theme alone does not toggle it).
    await page.evaluate((s) => { try { localStorage.setItem('reeeeecall-lang', 'ko') } catch {} ; document.documentElement.classList.toggle('dark', s === 'dark') }, scheme)
    const routes = scheme === 'light' ? ROUTES : ['/dashboard', '/brain', '/brain/play/memoryGrid', '/decks']
    for (const route of routes) {
      await page.goto(`${BASE}${route}`)
      await page.waitForTimeout(route.startsWith('/brain/play') ? 1200 : 2500)
      if (scheme === 'dark') await page.evaluate(() => document.documentElement.classList.add('dark'))
      // Dismiss celebration overlays so they do not cover the page being measured.
      await page.keyboard.press('Escape').catch(() => {})
      let r
      try {
        r = await page.evaluate((probe) => import(probe).then((m) => m.run()), PROBE)
      } catch (e) { r = { path: route, error: String(e).slice(0, 200) } }
      const name = `${vp.name}-${scheme}${route.replace(/\//g, '_').replace(DECK, 'deck')}`
      await page.screenshot({ path: new URL(`${name}.png`, outDir).pathname, fullPage: !route.startsWith('/brain/play') })
      results.push({ viewport: vp.name, scheme, route: route.replace(DECK, ':deckId'), ...r })
      process.stdout.write('.')
    }
    if (vp.name === 'phone' && scheme === 'light') {
      // The phone menu, opened — the navigation itself is part of what is being measured.
      await page.goto(`${BASE}/dashboard`)
      await page.waitForTimeout(2000)
      const btn = page.locator('header button[aria-label], header button').first()
      await btn.click().catch(() => {})
      await page.waitForTimeout(600)
      await page.screenshot({ path: new URL('phone-light-menu-open.png', outDir).pathname })
    }
    await ctx.close()
  }
}
await browser.close()
fs.writeFileSync(new URL(`./out/web-${label}.json`, import.meta.url), JSON.stringify(results, null, 1))
console.log(`\n${results.length} measurements → scripts/uiux-audit/out/web-${label}.json`)
