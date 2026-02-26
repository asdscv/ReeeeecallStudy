import { test as base } from '@playwright/test'
import { QuickStudyPage } from '../pages/quick-study.page'
import { StudySessionPage } from '../pages/study-session.page'
import { ExportModalPage } from '../pages/export-modal.page'

/**
 * Extended test fixtures with Page Object Models.
 * All E2E tests should use this `test` instead of importing from @playwright/test.
 *
 * Usage:
 *   import { test, expect } from '../fixtures/test-helpers'
 *   test('my test', async ({ quickStudyPage, studySessionPage, exportModalPage }) => { ... })
 */
export const test = base.extend<{
  quickStudyPage: QuickStudyPage
  studySessionPage: StudySessionPage
  exportModalPage: ExportModalPage
}>({
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
