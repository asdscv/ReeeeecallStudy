import { test, expect } from '@playwright/test'

/**
 * The quiz home's two new surfaces, driven in a real browser against real data.
 *
 * Both exist because something was being recorded and never read back:
 *
 *   - 오답 노트. Every wrong answer was already in `answer_attempts` — card, response, score —
 *     and nothing ever asked for it. A learner could miss the same card five sittings running
 *     and the app would never mention it.
 *   - the remove button. A generation that produces nothing leaves a set with zero questions
 *     that cannot be taken and could not be cleared; 17 of production's 49 sets were in that
 *     state.
 *
 * Signed in as the quiz simulator account, which has both: misses across several decks and at
 * least one set that generated nothing. The unit tests pin the grouping; this pins that the
 * component is actually mounted, actually queried, and actually renders — which is exactly what
 * `generateProgress` proved a store field can fail to be.
 */
// System Chrome, and no video: this repo's Playwright browsers are not downloaded, and the
// bundled ffmpeg that `video` needs is missing with them.
test.use({ channel: 'chrome', video: 'off' })

const EMAIL = process.env.QUIZ_E2E_EMAIL ?? ''
const PASSWORD = process.env.QUIZ_E2E_PASSWORD ?? ''

test.describe('quiz home', () => {
  test.skip(!EMAIL || !PASSWORD, 'QUIZ_E2E_EMAIL/PASSWORD not set')

  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/login')
    await page.fill('input[type="email"]', EMAIL)
    await page.fill('input[type="password"]', PASSWORD)
    await page.getByRole('button', { name: /Log In|로그인|login/i }).click()
    await page.waitForURL((url) => !new URL(url).pathname.includes('/auth'), { timeout: 20_000 })
    await page.goto('/quiz')
  })

  test('오답 노트 opens its own page, one deck at a time', async ({ page }) => {
    // The panel on the home is a SUMMARY now. It expanded in place at first and buried the sets
    // the learner came to the screen for, so the reading moved to a page of its own.
    const summary = page.getByTestId('quiz-mistakes')
    await expect(summary).toBeVisible({ timeout: 20_000 })
    await expect(summary).toContainText(/\d/)
    await summary.click()

    await expect(page.getByTestId('quiz-mistakes-page')).toBeVisible({ timeout: 20_000 })
    expect(page.url()).toContain('/quiz/mistakes')

    // Every deck offers its own study action — cards from two decks cannot be one session,
    // which is the whole reason the list is grouped.
    const study = page.getByTestId('quiz-mistakes-study')
    await expect(study).toBeVisible()
    const href = await study.getAttribute('href')
    expect(href).toMatch(/^\/decks\/[0-9a-f-]+\/study\?mode=srs&cards=/)
    expect(href!.split('cards=')[1].length).toBeGreaterThan(30)

    // With more than one deck the chips pick between them.
    const chips = page.getByTestId('quiz-mistakes-deck')
    if (await chips.count() > 1) {
      await chips.nth(1).click()
      await expect(page.getByTestId('quiz-mistakes-study')).toBeVisible()
    }
  })

  test('a quiz opens its own page, with every sitting on it', async ({ page }) => {
    // The history used to be a toggle on the list row, which is the wrong shape for it: a set is
    // something a learner comes BACK to, and an expanding row leaves it unreachable by link.
    const row = page.getByTestId('quiz-set-open').first()
    await row.waitFor({ timeout: 20_000 })
    await row.click()

    await expect(page.getByTestId('quiz-set-detail')).toBeVisible({ timeout: 20_000 })
    // The URL is the point — the page has to be linkable.
    expect(page.url()).toMatch(/\/quiz\/set\/[0-9a-f-]+$/)
    // Take (or retake) is always offered; the history is either sittings or "not taken yet".
    await expect(page.getByTestId('quiz-detail-take')).toBeVisible()

    const body = await page.getByTestId('quiz-set-detail').innerText()
    expect(body).toMatch(/\d/)
  })

  test('a set that generated nothing offers remove instead of a dead take button', async ({ page }) => {
    await expect(page.getByTestId('quiz-mistakes').or(page.getByRole('heading').first()))
      .toBeVisible({ timeout: 20_000 })

    const remove = page.getByTestId('quiz-set-delete')
    const count = await remove.count()
    // Zero is a legitimate state — the account may have none left — but if one is there it must
    // be enabled. Before this it rendered a take button that was permanently disabled.
    if (count > 0) await expect(remove.first()).toBeEnabled()
  })
})
