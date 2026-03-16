import { test, expect } from '../fixtures/test-helpers'

const GROK_API_KEY = process.env.E2E_GROK_API_KEY ?? ''

/**
 * E2E test for AI Auto-Generate feature.
 * Uses xAI/Grok API for real AI calls.
 *
 * Flow: DecksPage → "AI로 만들기" → Config → Template Review → Deck Review → Cards Review → Save → Done
 */

test.describe('AI Generate — Full Generation Flow', () => {
  test('full flow: generate template + deck + cards with Grok', async ({ page }) => {
    test.skip(!process.env.E2E_GROK_API_KEY, 'Grok API key required')
    // Increase timeout for AI API calls
    test.setTimeout(120_000)

    // 1. Go to Decks page
    await page.goto('/decks')
    await page.waitForTimeout(2000)

    // 2. Click "AI Generate" / "AI로 만들기" button
    const aiBtn = page.locator('button').filter({ hasText: /AI Generate|AI로 만들기/i })
    await expect(aiBtn).toBeVisible({ timeout: 10_000 })
    await aiBtn.click()

    // 3. Modal should open with config step
    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // 4. Select xAI provider
    const providerSelect = dialog.locator('select').first()
    await providerSelect.selectOption('xai')

    // 5. Enter API key
    const apiKeyInput = dialog.locator('input[type="password"]')
    await apiKeyInput.fill(GROK_API_KEY)

    // 6. Select grok-3-mini model
    const modelSelect = dialog.locator('select').nth(1)
    await modelSelect.selectOption('grok-3-mini')

    // 7. Enter topic
    const topicInput = dialog.locator('input[type="text"]').first()
    await topicInput.fill('Basic fruits in English and Korean (5 items)')

    // 8. Set card count to 10 (drag slider to min)
    const slider = dialog.locator('input[type="range"]')
    await slider.fill('10')

    // 9. Click start
    const startBtn = dialog.locator('button[type="submit"]')
    await expect(startBtn).toBeEnabled()
    await startBtn.click()

    // 10. Wait for template generation (AI call — may take time)
    // Should show generating spinner then move to review
    await expect(dialog.locator('text=Review Template').or(dialog.locator('text=템플릿 검토'))).toBeVisible({ timeout: 60_000 })

    // 11. Template review step — verify fields exist
    const fieldInputs = dialog.locator('div.bg-gray-50 input[type="text"]')
    const fieldCount = await fieldInputs.count()
    expect(fieldCount).toBeGreaterThanOrEqual(2)

    // 12. Click "Next" to proceed to deck generation
    const nextBtn = dialog.locator('button').filter({ hasText: /Next|다음/i })
    await nextBtn.click()

    // 13. Wait for deck generation
    await expect(dialog.locator('text=Review Deck').or(dialog.locator('text=덱 검토'))).toBeVisible({ timeout: 60_000 })

    // 14. Verify deck preview shows name and icon
    const deckPreview = dialog.locator('.rounded-xl.bg-gray-50')
    await expect(deckPreview).toBeVisible()

    // 15. Click "Next" to proceed to card generation
    const nextBtn2 = dialog.locator('button').filter({ hasText: /Next|다음/i })
    await nextBtn2.click()

    // 16. Wait for card generation
    await expect(dialog.locator('text=/\\d+ cards generated|\\d+장의 카드/i')).toBeVisible({ timeout: 60_000 })

    // 17. Verify cards table has rows
    const cardRows = dialog.locator('table tbody tr')
    const rowCount = await cardRows.count()
    expect(rowCount).toBeGreaterThanOrEqual(1)
    console.log(`Generated ${rowCount} cards`)

    // 18. Click Save
    const saveBtn = dialog.locator('button').filter({ hasText: /Save|저장/i }).last()
    await saveBtn.click()

    // 19. Wait for save completion → Done step (use h3 specifically to avoid strict mode violation with DialogTitle)
    await expect(dialog.locator('h3').filter({ hasText: /Done!|완료!/i })).toBeVisible({ timeout: 30_000 })

    // 20. Verify done step shows summary
    await expect(dialog.locator('text=/cards? created|카드가 생성/i')).toBeVisible()

    // 21. Click "View Deck" to navigate
    const viewDeckBtn = dialog.locator('button').filter({ hasText: /View Deck|덱 보기/i })
    await expect(viewDeckBtn).toBeVisible()
    await viewDeckBtn.click()

    // 22. Should navigate to deck detail page
    await page.waitForURL(/\/decks\/[a-z0-9-]+/, { timeout: 10_000 })

    // 23. Verify cards appear in the deck
    await page.waitForTimeout(2000)
    const deckCards = page.locator('table tbody tr').or(page.locator('.bg-white.rounded-xl.border'))
    const deckCardCount = await deckCards.count()
    expect(deckCardCount).toBeGreaterThanOrEqual(1)
    console.log(`Deck has ${deckCardCount} cards after AI generation`)
  })
})

test.describe('AI Generate — Error Handling', () => {
  test('shows error for invalid API key', async ({ page }) => {
    test.skip(!process.env.E2E_GROK_API_KEY, 'Grok API key required')
    test.setTimeout(60_000)

    await page.goto('/decks')
    await page.waitForTimeout(2000)

    // Open AI Generate modal
    const aiBtn = page.locator('button').filter({ hasText: /AI Generate|AI로 만들기/i })
    await aiBtn.click()

    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog).toBeVisible()

    // Select xAI, enter invalid key
    const providerSelect = dialog.locator('select').first()
    await providerSelect.selectOption('xai')

    const apiKeyInput = dialog.locator('input[type="password"]')
    await apiKeyInput.fill('xai-invalid-key-12345')

    const modelSelect = dialog.locator('select').nth(1)
    await modelSelect.selectOption('grok-3-mini')

    const topicInput = dialog.locator('input[type="text"]').first()
    await topicInput.fill('test topic')

    const slider = dialog.locator('input[type="range"]')
    await slider.fill('10')

    // Submit
    const startBtn = dialog.locator('button[type="submit"]')
    await startBtn.click()

    // Should show error step (use h3 to avoid strict mode violation)
    await expect(dialog.locator('h3').filter({ hasText: /Error|오류/i })).toBeVisible({ timeout: 30_000 })

    // Error message should be visible
    const errorMsg = dialog.locator('.bg-red-50')
    await expect(errorMsg).toBeVisible()

    // Retry and Back buttons should be visible
    await expect(dialog.locator('button').filter({ hasText: /Retry|재시도/i })).toBeVisible()
    await expect(dialog.locator('button').filter({ hasText: /Go Back|돌아가기/i })).toBeVisible()
  })
})

test.describe('AI Generate — UI Integration Points', () => {
  test('AI button visible on DecksPage', async ({ page }) => {
    await page.goto('/decks')
    await page.waitForTimeout(2000)
    const aiBtn = page.locator('button').filter({ hasText: /AI Generate|AI로 만들기/i })
    await expect(aiBtn).toBeVisible()
  })

  test('AI button visible on DeckDetailPage', async ({ page }) => {
    // Navigate to first deck
    await page.goto('/decks')
    await page.waitForTimeout(2000)

    // Click first deck card to navigate to detail
    const firstDeck = page.locator('a[href*="/decks/"]').first()
    if (await firstDeck.isVisible()) {
      await firstDeck.click()
      await page.waitForTimeout(2000)

      const aiBtn = page.locator('button').filter({ hasText: /AI Cards|AI 카드 생성/i })
      await expect(aiBtn).toBeVisible()
    }
  })

  test('Templates page loads without AI Deck button (removed)', async ({ page }) => {
    await page.goto('/templates')
    await page.waitForTimeout(2000)

    // AI Deck button was removed — verify it's not there
    const aiDeckBtn = page.locator('button').filter({ hasText: /AI Deck/i }).first()
    await expect(aiDeckBtn).not.toBeVisible()
  })
})
