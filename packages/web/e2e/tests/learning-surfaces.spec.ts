import { test, expect } from '../fixtures/test-helpers'

/**
 * The learning surfaces, driven in a real browser against a real database.
 *
 * Not a re-test of arithmetic — the kernel has unit tests and the RPCs have SQL suites. What only
 * a browser can answer is whether the screens this restructure produced actually render, connect
 * to each other, and say something a person can read. Every step also captures a screenshot,
 * because "the element exists" and "the screen is usable" are different claims and the second one
 * needs eyes.
 */

const SHOTS = 'playwright/learning'

test.describe('learning surfaces', () => {
  test('dashboard shows the plan in one line and opens it', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: `${SHOTS}/01-dashboard.png`, fullPage: true })

    // The widget renders nothing without a goal, so its presence IS the assertion. Named by its
    // CONTENTS, not an aria-label — an aria-label here erased the title and numbers from the
    // accessibility tree, and this selector is what a screen reader would have to work with too.
    const widget = page.getByRole('link', { name: /JLPT N2/ })
    await expect(widget).toBeVisible()
    await expect(widget).toContainText('JLPT N2')

    await widget.click()
    await expect(page).toHaveURL(/\/learning\/[0-9a-f-]{36}/)
    await page.screenshot({ path: `${SHOTS}/02-plan-from-dashboard.png`, fullPage: true })
  })

  test('/learning lists plans, and a plan opens from the list', async ({ page }) => {
    await page.goto('/learning')
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: `${SHOTS}/03-plan-list.png`, fullPage: true })

    const planLink = page.getByRole('link', { name: /JLPT N2/ })
    await expect(planLink).toBeVisible()
    await planLink.click()

    await expect(page).toHaveURL(/\/learning\/[0-9a-f-]{36}/)
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: `${SHOTS}/04-plan-detail.png`, fullPage: true })

    // Progress is the point of the detail screen. It is server-aggregated, so its presence also
    // proves get_goal_knowledge answered.
    await expect(page.getByLabel(/진행 상황|Progress/i)).toBeVisible()

    // And the one way back.
    const back = page.getByRole('link', { name: /플랜 목록|All plans/i })
    await expect(back).toBeVisible()
    await back.click()
    await expect(page).toHaveURL(/\/learning$/)
  })

  test('the goal form never asks again for what the app can answer itself', async ({ page }) => {
    await page.goto('/learning')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /새 목표|New goal|Create/i }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/05-goal-form-empty.png`, fullPage: true })

    await expect(dialog.getByPlaceholder(/JLPT|목표|e\.g\./i)).toBeVisible()
    await expect(dialog.locator('input[type="date"]')).toBeVisible()
    await expect(dialog.locator('input[type="checkbox"]').first()).toBeVisible()

    // What must never come back, and why each was removed:
    //   과목      the two shipped domain adapters are byte-identical apart from their id, so the
    //             choice changed nothing, and the subject is already on the deck.
    //   덱별 중요도  worth at most 0.10 of a ranking score, and a question the app answers better.
    // Asserted by NAME rather than by counting controls — a bare "no combobox" assertion also
    // forbade the study-days selector another workstream legitimately added.
    const text = (await dialog.innerText()) ?? ''
    expect(text).not.toMatch(/과목|Subject|Materia|科目/i)
    expect(text).not.toMatch(/중요도|Priority|Importance/i)

    // Pick a deck and a date, then the preview must produce a daily cost.
    await dialog.locator('input[type="checkbox"]').first().check()
    const target = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10)
    await dialog.locator('input[type="date"]').fill(target)

    const preview = dialog.getByLabel(/예상 학습 계획|Estimated plan/i)
    await expect(preview).toBeVisible()
    // The peak is reported next to the average, because the average alone understates the day
    // the learner actually has to survive.
    await expect(preview).toContainText(/분|min/)
    await page.screenshot({ path: `${SHOTS}/06-goal-form-with-plan.png`, fullPage: true })
  })

  test('no raw i18n key reaches the screen on any learning surface', async ({ page }) => {
    // i18next renders a missing key by echoing it, and this shipped broken before: an entire
    // family of mobile keys rendered as literal "today.rate.again" text.
    const RAW = /\b(today|goals|form|progress|insights|enrichment)\.[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+/
    for (const path of ['/dashboard', '/learning']) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const body = (await page.locator('body').innerText()) ?? ''
      const hit = body.match(RAW)
      expect(hit?.[0], `raw i18n key on ${path}: ${hit?.[0]}`).toBeUndefined()
    }
  })
})
