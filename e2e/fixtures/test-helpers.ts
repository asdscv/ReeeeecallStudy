import { test as base } from '@playwright/test'
import { QuickStudyPage } from '../pages/quick-study.page'
import { StudySessionPage } from '../pages/study-session.page'

/**
 * Extended test fixtures with Page Object Models.
 * All E2E tests should use this `test` instead of importing from @playwright/test.
 *
 * Usage:
 *   import { test, expect } from '../fixtures/test-helpers'
 *   test('my test', async ({ quickStudyPage, studySessionPage }) => { ... })
 */
export const test = base.extend<{
  quickStudyPage: QuickStudyPage
  studySessionPage: StudySessionPage
}>({
  quickStudyPage: async ({ page }, use) => {
    await use(new QuickStudyPage(page))
  },
  studySessionPage: async ({ page }, use) => {
    await use(new StudySessionPage(page))
  },
})

export { expect } from '@playwright/test'
