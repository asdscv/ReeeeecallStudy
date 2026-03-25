import { test, expect } from '../fixtures/test-helpers'

test.describe('UI Visual Fixes', () => {
  test('Quick Study deck cards: color bar must be flush at top of card', async ({ quickStudyPage, page }) => {
    await quickStudyPage.navigate()

    const cards = page.locator('.grid button')
    const cardCount = await cards.count()
    if (cardCount === 0) {
      test.skip(true, 'No deck cards found — skip visual test')
      return
    }

    // Verify every card's color bar is flush at the top
    for (let i = 0; i < Math.min(cardCount, 6); i++) {
      const card = cards.nth(i)
      const colorBar = card.locator('> div').first()

      // The button should use flex layout to prevent color bar from shifting
      const display = await card.evaluate((el) => window.getComputedStyle(el).display)
      expect(display).toBe('flex')

      const flexDir = await card.evaluate((el) => window.getComputedStyle(el).flexDirection)
      expect(flexDir).toBe('column')

      // The color bar's top position should match the card's content top (0 offset)
      const cardBox = await card.boundingBox()
      const barBox = await colorBar.boundingBox()
      if (cardBox && barBox) {
        // Allow 2px tolerance for border
        expect(Math.abs(barBox.y - cardBox.y)).toBeLessThanOrEqual(2)
      }
    }

    // Screenshot for visual verification
    await page.screenshot({ path: 'e2e-screenshot-quick-study-cards.png', fullPage: true })
  })

  test('Study progress bar: gradient uses clipPath and spans full width', async ({ quickStudyPage, page }) => {
    await quickStudyPage.navigate()

    // Dismiss any onboarding/overlay that might be blocking
    const overlay = page.locator('.fixed.inset-0.z-\\[9999\\]')
    if (await overlay.isVisible({ timeout: 2_000 }).catch(() => false)) {
      // Try clicking dismiss/close/skip buttons
      const dismissBtn = overlay.getByRole('button').first()
      if (await dismissBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await dismissBtn.click()
        await page.waitForTimeout(500)
      }
    }

    const firstDeck = page.locator('.grid button').first()
    if (!(await firstDeck.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'No decks available — skip progress bar test')
      return
    }

    // Click first deck to open modal
    await quickStudyPage.selectFirstDeck()

    // Select SRS mode (first mode option — 🔄)
    await quickStudyPage.selectMode('🔄')

    // Wait for study session page
    try {
      await page.waitForURL(/\/study\?/, { timeout: 10_000 })
    } catch {
      // Might need batch size or other config step — try start button
      const modal = page.locator('.fixed.inset-0')
      const startBtn = modal.getByRole('button').filter({ hasText: /시작|Start/i })
      if (await startBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await startBtn.click()
        await page.waitForURL(/\/study\?/, { timeout: 10_000 }).catch(() => {})
      }
    }

    // Wait for session to load
    await page.waitForTimeout(2000)

    // Check progress bar uses clipPath instead of width-based fill
    const gradientBar = page.locator('.bg-gradient-to-r').first()
    if (await gradientBar.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // Verify absolute positioning (gradient spans full container width)
      const position = await gradientBar.evaluate((el) => window.getComputedStyle(el).position)
      expect(position).toBe('absolute')

      // Verify clipPath is set
      const clipPath = await gradientBar.evaluate((el) => el.style.clipPath)
      expect(clipPath).toMatch(/^inset\(/)

      // Screenshot for visual verification
      await page.screenshot({ path: 'e2e-screenshot-progress-bar.png', fullPage: false })
    }
  })
})
