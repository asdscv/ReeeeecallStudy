/**
 * The deployed learning plan screen, photographed against PRODUCTION.
 *
 * Every earlier check ran against a local build. This one opens the site a learner opens,
 * with the bundle Cloudflare is actually serving, on an account whose data has been shaped
 * into the reported state: today's plan finished, its cards sitting in learning steps due
 * back in minutes, nothing genuinely late.
 *
 * That is precisely the state that produced "복습이 12장 밀렸어요" over "복습할 카드가
 * 없습니다", so the assertions are the two sentences that must NOT appear.
 */
import { test, expect } from '@playwright/test'

test.use({ channel: 'chrome', video: 'off' })

const GOAL = process.env.PLAN_WEEK_GOAL_ID

test('the deployed plan screen tells the truth', async ({ page }) => {
  test.skip(!GOAL, 'set PLAN_WEEK_GOAL_ID')

  await page.goto('/auth/login')
  await page.fill('input[type="email"]', process.env.E2E_TEST_EMAIL!)
  await page.fill('input[type="password"]', process.env.E2E_TEST_PASSWORD!)
  await page.getByRole('button', { name: /Log In|로그인|Sign In|login/i }).click()
  await page.waitForURL((u) => !new URL(u).pathname.includes('/auth'), { timeout: 25_000 })

  await page.evaluate(() => window.localStorage.setItem('reeeeecall-lang', 'ko'))
  await page.goto(`/learning/${GOAL}`)
  // Wait for the goal-progress card specifically: it is the one the false backlog lived on,
  // and a timeout-based wait can photograph the screen before its read has landed.
  await expect(page.getByTestId('progress-headline')).toBeVisible({ timeout: 25_000 })
  await page.waitForTimeout(3000)

  const body = await page.locator('body').innerText()

  // The two sentences the report was about. Neither is true of this account.
  expect(body, 'the false backlog is back').not.toMatch(/복습이 \d+장 밀렸어요/)
  expect(body, 'the old empty state is back').not.toContain('오늘 이 덱들에서 복습할 카드가 없습니다')
  // And the unexplained estimate.
  expect(body, 'the unlabelled ETA is back').not.toMatch(/완료까지 약 \d+일/)
  expect(body, 'adherence is back on the screen').not.toMatch(/플랜 \d+% 이행/)

  // The week strip must be there — it is the section built never to hide.
  await expect(page.getByTestId('plan-week-strip')).toBeVisible({ timeout: 15_000 })

  await page.screenshot({ path: 'playwright/prod/plan-desktop.png', fullPage: true })

  // ── THE REPORTED ACTION ────────────────────────────────────────────────────
  // 더 하기 on a finished day. The plan must survive it, and the answer must be about the
  // extension rather than about the decks.
  const extend = page.getByRole('button', { name: '더 하기' })
  if (await extend.isVisible().catch(() => false)) {
    await extend.click()
    await page.waitForTimeout(6000)
    const after = await page.locator('body').innerText()

    expect(after, 'the finished plan was erased again').toContain('오늘 끝!')
    expect(after).not.toContain('오늘 이 덱들에서 복습할 카드가 없습니다')
    // Either "nothing more to add" or the caught-up card — both are answers to the button.
    expect(after).toMatch(/더 넣을 것이 없습니다|오늘 몫은 끝났어요/)
    await page.screenshot({ path: 'playwright/prod/plan-after-extend.png', fullPage: true })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'playwright/prod/plan-mobile.png', fullPage: true })
})
