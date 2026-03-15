/**
 * Verify GuideHelpLink is visible on all major pages.
 */
import { test, expect } from '../fixtures/test-helpers'

const PAGES_WITH_GUIDE = [
  { path: '/dashboard', section: 'getting-started', label: 'Dashboard' },
  { path: '/quick-study', section: 'study', label: 'Quick Study' },
  { path: '/decks', section: 'decks', label: 'Decks' },
  { path: '/templates', section: 'templates', label: 'Templates' },
  { path: '/marketplace', section: 'marketplace', label: 'Marketplace' },
  { path: '/history', section: 'history', label: 'History' },
  { path: '/ai-generate', section: 'ai-generate', label: 'AI Generate' },
]

test.describe('Guide Help Links on Pages', () => {
  for (const { path, section, label } of PAGES_WITH_GUIDE) {
    test(`${label} page (${path}) has guide link to #${section}`, async ({ page }) => {
      await page.goto(path)
      await page.waitForTimeout(2000)

      // Find the guide help link — it's an <a> linking to /guide#section
      const guideLink = page.locator(`a[href="/guide#${section}"]`)
      await expect(guideLink).toBeVisible({ timeout: 5000 })

      // Take screenshot for verification
      await page.screenshot({ path: `test-results/guide-link-${label.toLowerCase().replace(/\s/g, '-')}.png` })
    })
  }

  test('guide deep link opens correct section', async ({ page }) => {
    await page.goto('/guide#ai-generate')
    await page.waitForTimeout(2000)

    // The ai-generate section should be open and highlighted
    const section = page.locator('#guide-ai-generate')
    await expect(section).toBeVisible()

    // Section content should be visible (it's open)
    const sectionContent = section.locator('.border-t')
    await expect(sectionContent).toBeVisible()
  })
})
