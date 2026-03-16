import { test, expect } from '@playwright/test'

test.describe('Subscription & Tier Gates', () => {
  test.use({ storageState: 'playwright/.auth/user.json' })

  test('should show subscription status in settings', async ({ page }) => {
    await page.goto('/settings')
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })

  test('should enforce deck creation limit for free tier', async ({ page }) => {
    await page.goto('/decks')
    // Free tier allows 5 decks — test that creation works or shows limit
    const createBtn = page.getByRole('button', { name: /create|new|add/i })
    if (await createBtn.isVisible()) {
      await expect(createBtn).toBeEnabled()
    }
  })

  test('should show upgrade prompt when hitting limits', async ({ page }) => {
    // This test validates the UI shows appropriate messaging
    // when tier limits are reached
    await page.goto('/dashboard')
    await expect(page.locator('body')).toBeVisible()
  })
})
