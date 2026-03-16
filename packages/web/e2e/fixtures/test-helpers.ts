import { test as base } from '@playwright/test'
import { QuickStudyPage } from '../pages/quick-study.page'
import { StudySessionPage } from '../pages/study-session.page'
import { ExportModalPage } from '../pages/export-modal.page'

/**
 * Extended test fixtures with Page Object Models + fresh login per test.
 *
 * Supabase only allows 1 active session per user, so each test must
 * re-authenticate instead of sharing a stored auth state.
 */
export const test = base.extend<{
  quickStudyPage: QuickStudyPage
  studySessionPage: StudySessionPage
  exportModalPage: ExportModalPage
}>({
  // Fresh login for every test — bypasses single-session limitation
  page: async ({ page }, use) => {
    const email = process.env.E2E_TEST_EMAIL
    const password = process.env.E2E_TEST_PASSWORD
    if (email && password) {
      await page.goto('/auth/login')
      await page.fill('input[type="email"]', email)
      await page.fill('input[type="password"]', password)
      await page.getByRole('button', { name: /Log In|로그인|login/i }).click()
      await page.waitForURL(url => {
        const path = new URL(url).pathname
        return !path.includes('/auth') && !path.includes('/landing')
      }, { timeout: 15_000 }).catch(() => {})
    }
    await use(page)
  },
  quickStudyPage: async ({ page }, use) => {
    await use(new QuickStudyPage(page))
  },
  studySessionPage: async ({ page }, use) => {
    await use(new StudySessionPage(page))
  },
  exportModalPage: async ({ page }, use) => {
    await use(new ExportModalPage(page))
  },
})

export { expect } from '@playwright/test'
