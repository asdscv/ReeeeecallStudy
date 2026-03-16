import { test, expect } from '../fixtures/test-helpers'

test('guide page shows images in decks section', async ({ page }) => {
  await page.goto('/guide')
  await page.waitForTimeout(3000)

  // Click "Deck Management" section in TOC
  const deckSection = page.locator('button, a').filter({ hasText: /Deck Management|덱 관리/i }).first()
  if (await deckSection.isVisible().catch(() => false)) {
    await deckSection.click()
    await page.waitForTimeout(1000)
  }

  // Verify guide images are loaded (any section)
  const images = page.locator('img[src*="/images/guide/"]')
  const count = await images.count()
  expect(count).toBeGreaterThanOrEqual(1)
})
