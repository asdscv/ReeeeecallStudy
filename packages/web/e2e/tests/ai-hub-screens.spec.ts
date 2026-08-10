import { test } from '../fixtures/test-helpers'

// Playwright's bundled chromium is not downloaded on this machine; the installed Chrome is.
// Same escape hatch as `card-limit-ui.spec.ts`. Video is off because this suite's output IS
// its screenshots — recording would only add a dependency on a bundled ffmpeg.
test.use({ channel: 'chrome', video: 'off' })

/**
 * Screenshot audit for the AI 학습 hub and every surface it gathers.
 *
 * Not an assertion suite — its output is the `e2e/screenshots/ai-hub/` folder, which is
 * read by eye (and by the design audit) after a change to the AI menu. Kept as a spec
 * rather than a script so it inherits the fresh-login fixture: Supabase allows one web
 * session at a time, so a standalone script would keep kicking whatever else is signed in.
 */

const SCHEMES = ['light', 'dark'] as const

// The hub plus every surface it gathers. The three feature paths are unchanged by this menu —
// only where they are reached from is new — so a shot of each is the regression baseline.
const SURFACES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'ai-hub', path: '/ai' },
  { name: 'learning-plan', path: '/learning' },
  { name: 'quiz', path: '/quiz' },
  { name: 'ai-generate', path: '/ai-generate' },
  { name: 'ai-generate-cards-only', path: '/ai-generate?mode=cards_only' },
  { name: 'decks', path: '/decks' },
]

test.describe('AI hub — screenshot audit', () => {
  for (const scheme of SCHEMES) {
    for (const { name, path } of SURFACES) {
      test(`${scheme}: ${name}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme })
        await page.goto(path)
        await page.waitForTimeout(2500)
        if (scheme === 'dark') {
          // `useTheme` resolves the profile's stored theme LAST and wins over both localStorage
          // and prefers-color-scheme, so the test account's 'light' would come back after login
          // and every "dark" shot would be a duplicate of its light twin — which is exactly what
          // happened the first time this ran. The class is what the CSS variables key off, so
          // setting it directly is the honest way to photograph the dark palette without
          // writing a theme change into a real account.
          await page.evaluate(() => document.documentElement.classList.add('dark'))
          await page.waitForTimeout(400)
        }
        await page.screenshot({
          path: `e2e/screenshots/ai-hub/${scheme}-${name}.png`,
          fullPage: true,
        })
      })
    }
  }

  // The menu itself only exists once opened, so it needs its own shot.
  test('nav: study group expanded', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: /학습|Study/ }).first().click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'e2e/screenshots/ai-hub/nav-study-open.png' })
  })
})
