/**
 * The learning plan screen, photographed.
 *
 * The defect being fixed is a VISUAL one — "학습플랜에 너무 아무것도 없다니까? 그대로네?" — and
 * no assertion about a store or an RPC can settle whether a screen looks empty. So this opens
 * the real goal and photographs it, and asserts the two things that were missing from the
 * picture: the week is on the page, and it has seven days in it.
 */
import { test, expect } from '@playwright/test'

// System Chrome: the bundled chromium is not installed on this machine, and downloading a
// browser is not part of verifying a screen.
// `video: 'off'` because the config's retain-on-failure needs ffmpeg, which is part of the
// same uninstalled bundle.
test.use({ channel: 'chrome', video: 'off' })

// Needs a goal with a week of history behind it, which no CI job has. CI typechecks these
// specs but does not run them; locally, point it at a seeded goal:
//
//   PLAN_WEEK_GOAL_ID=<uuid> npx playwright test e2e/tests/plan-week-visual.spec.ts
const GOAL = process.env.PLAN_WEEK_GOAL_ID

test('the learning plan screen is not empty', async ({ page }) => {
  test.skip(!GOAL, 'set PLAN_WEEK_GOAL_ID to a goal with a week of history')
  await page.goto('/auth/login')
  await page.fill('input[type="email"]', process.env.E2E_TEST_EMAIL!)
  await page.fill('input[type="password"]', process.env.E2E_TEST_PASSWORD!)
  await page.getByRole('button', { name: /Log In|로그인|login/i }).click()
  await page.waitForURL((u) => !new URL(u).pathname.includes('/auth'), { timeout: 20_000 })

  // Korean, because that is what the report was written in and what the copy was written for.
  await page.evaluate(() => window.localStorage.setItem('reeeeecall-lang', 'ko'))
  await page.goto(`/learning/${GOAL}`)
  const strip = page.getByTestId('plan-week-strip')
  await expect(strip).toBeVisible({ timeout: 20_000 })
  await expect(strip.locator('> div')).toHaveCount(7)

  await page.waitForTimeout(2500)   // let the check count and diagnostics land
  await page.screenshot({ path: 'playwright/learning/plan-week-desktop.png', fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'playwright/learning/plan-week-mobile.png', fullPage: true })
})
