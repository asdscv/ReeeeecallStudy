import { test, expect } from '../fixtures/test-helpers'

test.describe('Official Account - Admin Users Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/users')

    // Gracefully skip if not admin (redirected away)
    const url = page.url()
    if (!url.includes('/admin/users')) {
      test.skip()
    }
  })

  test('Official column header exists in user table', async ({ page }) => {
    // 4th th in the user list table (Name, Role, Official, Joined)
    const headers = page.locator('table thead th')
    await expect(headers).toHaveCount(4)
    // The 3rd column (index 2) is the Official column
    await expect(headers.nth(2)).toBeVisible()
  })

  test('toggle button exists with data-testid', async ({ page }) => {
    const firstToggle = page.locator('[data-testid^="official-toggle-"]').first()
    await expect(firstToggle).toBeVisible({ timeout: 10_000 })
  })

  test('click toggle changes button text', async ({ page }) => {
    const firstToggle = page.locator('[data-testid^="official-toggle-"]').first()
    await expect(firstToggle).toBeVisible({ timeout: 10_000 })

    const textBefore = await firstToggle.textContent()
    await firstToggle.click()

    // Wait for loading to finish and text to change
    await expect(firstToggle).not.toHaveText('...')
    await expect(firstToggle).not.toHaveText(textBefore!)
  })
})
