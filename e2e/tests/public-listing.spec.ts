import { test, expect } from '../fixtures/test-helpers'

test.describe('Public Listing Preview - /d/:listingId', () => {
  test('should show 404 for non-existent listing', async ({ page }) => {
    await page.goto('/d/00000000-0000-0000-0000-000000000000')

    // Should show 404 message
    await expect(page.getByText('404')).toBeVisible({ timeout: 10_000 })
  })

  test('should show 404 for invalid listing ID format', async ({ page }) => {
    await page.goto('/d/not-a-valid-uuid')

    // Invalid UUID → RPC error → 404
    await expect(page.getByText('404')).toBeVisible({ timeout: 10_000 })
  })

  test('should have nav bar on public listing page', async ({ page }) => {
    await page.goto('/d/00000000-0000-0000-0000-000000000000')

    // Wait for page to load (either 404 or listing)
    await expect(page.getByText('404')).toBeVisible({ timeout: 10_000 })

    // ContentNav back link should always be present
    const backLink = page.getByRole('link', { name: /home|ホーム|홈|首页/i })
    await expect(backLink).toBeVisible()
  })

  test('should not require authentication to view', async ({ browser }) => {
    // Create a fresh context without stored auth state
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto('/d/00000000-0000-0000-0000-000000000000')

    // Should NOT redirect to /auth/login — page stays on /d/
    await expect(page).toHaveURL(/\/d\//)

    // Should show 404 (not login page)
    await expect(page.getByText('404')).toBeVisible({ timeout: 10_000 })

    await context.close()
  })
})
