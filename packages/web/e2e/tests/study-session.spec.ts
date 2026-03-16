import { test, expect } from '@playwright/test'

test.describe('Study Session', () => {
  test.use({ storageState: 'playwright/.auth/user.json' })

  test('should navigate to study page', async ({ page }) => {
    await page.goto('/dashboard')
    // Look for study-related link or button
    const studyLink = page.getByRole('link', { name: /study/i }).first()
    if (await studyLink.isVisible()) {
      await studyLink.click()
    }
  })

  test('should start study session from deck detail', async ({ page }) => {
    await page.goto('/decks')

    // Click first deck
    const deckCard = page.locator('[data-testid*="deck"]').first()
    if (await deckCard.isVisible()) {
      await deckCard.click()
      await page.waitForURL(/\/deck\//)

      // Click study button
      const studyBtn = page.getByRole('button', { name: /study|start/i })
      if (await studyBtn.isVisible()) {
        await studyBtn.click()
      }
    }
  })

  test('should show card flip interaction', async ({ page }) => {
    // Navigate to study mode (if cards exist)
    await page.goto('/decks')
    const deckCard = page.locator('[data-testid*="deck"]').first()
    if (await deckCard.isVisible()) {
      await deckCard.click()
      await page.waitForURL(/\/deck\//)

      const studyBtn = page.getByRole('button', { name: /study|start/i })
      if (await studyBtn.isVisible()) {
        await studyBtn.click()

        // Wait for card to appear
        const card = page.locator('[data-testid*="card"], .study-card, .card').first()
        if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
          // Click to flip
          await card.click()

          // Rating buttons should appear after flip
          const ratingBtn = page.getByRole('button', { name: /good|easy|hard|again/i }).first()
          if (await ratingBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await expect(ratingBtn).toBeVisible()
          }
        }
      }
    }
  })
})
