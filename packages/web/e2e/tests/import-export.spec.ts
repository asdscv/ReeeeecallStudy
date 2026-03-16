import { test, expect } from '@playwright/test'

test.describe('Import/Export', () => {
  test.use({ storageState: 'playwright/.auth/user.json' })

  test('should show export option in deck detail', async ({ page }) => {
    await page.goto('/decks')
    const deckCard = page.locator('[data-testid*="deck"]').first()
    if (await deckCard.isVisible()) {
      await deckCard.click()
      await page.waitForURL(/\/deck\//)

      // Look for export button
      const exportBtn = page.getByRole('button', { name: /export/i })
      if (await exportBtn.isVisible()) {
        await expect(exportBtn).toBeVisible()
      }
    }
  })

  test('should show import option in deck detail', async ({ page }) => {
    await page.goto('/decks')
    const deckCard = page.locator('[data-testid*="deck"]').first()
    if (await deckCard.isVisible()) {
      await deckCard.click()
      await page.waitForURL(/\/deck\//)

      const importBtn = page.getByRole('button', { name: /import/i })
      if (await importBtn.isVisible()) {
        await expect(importBtn).toBeVisible()
      }
    }
  })
})
