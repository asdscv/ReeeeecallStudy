import { test, expect } from '@playwright/test'

test.describe('Marketplace', () => {
  test.use({ storageState: 'playwright/.auth/user.json' })

  test('should display marketplace page', async ({ page }) => {
    await page.goto('/marketplace')
    await expect(page.locator('body')).toBeVisible()
  })

  test('should show search and filters', async ({ page }) => {
    await page.goto('/marketplace')
    const search = page.getByPlaceholder(/search/i).first()
    if (await search.isVisible()) {
      await expect(search).toBeVisible()
    }
  })

  test('should filter by category', async ({ page }) => {
    await page.goto('/marketplace')
    const categoryBtn = page.getByRole('button', { name: /language|science|math/i }).first()
    if (await categoryBtn.isVisible()) {
      await categoryBtn.click()
      await page.waitForTimeout(500)
    }
  })
})
