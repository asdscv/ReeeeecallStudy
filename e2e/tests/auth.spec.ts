import { test, expect } from '../fixtures/test-helpers'

test.describe('Authentication', () => {
  test('authenticated user can access dashboard', async ({ page }) => {
    await page.goto('/')
    // Should NOT be redirected to /landing
    await expect(page).not.toHaveURL(/\/landing/)
  })

  test('authenticated user can access quick-study page', async ({ page }) => {
    await page.goto('/quick-study')
    await expect(page).toHaveURL(/\/quick-study/)
  })

  test('authenticated user can access decks page', async ({ page }) => {
    await page.goto('/decks')
    await expect(page).toHaveURL(/\/decks/)
  })
})
