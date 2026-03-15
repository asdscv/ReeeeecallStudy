import { test, expect } from '../fixtures/test-helpers'

test('guide page shows images in decks section', async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    storageState: 'playwright/.auth/user.json',
  })
  const page = await ctx.newPage()
  await page.goto('/guide#decks')
  await page.waitForTimeout(3000)

  // Verify images are loaded
  const images = page.locator('#guide-decks img[src*="/images/guide/"]')
  const count = await images.count()
  expect(count).toBeGreaterThanOrEqual(1)

  await page.screenshot({ path: 'test-results/guide-with-images.png', fullPage: true })
  await ctx.close()
})
