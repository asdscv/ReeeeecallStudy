import { test, expect } from '../fixtures/test-helpers'

// Smoke test for the new Quick Create (간편 만들기) flow: name a deck, pick a
// default template preset, type a card, create — and land on the new deck with
// the card visible. Uses fresh-login-per-test (Supabase single-session).
// Creates real data under the E2E test account; cleaned up afterwards via SQL.

const MARKER = 'QCSMOKE'

test.describe('Quick Create flow', () => {
  test('creates a deck with a card in one step and opens it', async ({ page }) => {
    const deckName = `${MARKER}-${Date.now()}`
    const frontText = `${MARKER}-front-${Date.now()}`

    await page.goto('/decks')

    // Open the Quick Create modal.
    await page.getByTestId('quick-create-button').click()

    // Deck name field appears immediately; card fields appear once the default
    // template (seeded via ensure_default_templates) loads and is preselected.
    await page.getByTestId('qc-deck-name').fill(deckName)
    await expect(page.getByTestId('qc-card-0-0')).toBeVisible({ timeout: 15_000 })

    // Fill the first two fields of the first card row (works for any preset).
    await page.getByTestId('qc-card-0-0').fill(frontText)
    const back = page.getByTestId('qc-card-0-1')
    if (await back.isVisible().catch(() => false)) {
      await back.fill(`${MARKER}-back`)
    }

    // Create → should navigate to the new deck's detail page.
    await page.getByTestId('qc-submit').click()
    await page.waitForURL(/\/decks\/[0-9a-fA-F-]{8,}/, { timeout: 20_000 })

    // The card we typed should be visible on the deck detail.
    await expect(page.getByText(frontText).first()).toBeVisible({ timeout: 15_000 })
  })

  test('AI generate page renders translated (namespace loads)', async ({ page }) => {
    await page.goto('/ai-generate')
    await expect(page).toHaveURL(/\/ai-generate/)
    // If the ai-generate i18n namespace failed to load, t() would render raw
    // dot-path keys. Assert none of those leak into the page.
    const body = page.locator('body')
    await expect(body).toBeVisible()
    await expect(body).not.toContainText('ai-generate:')
    await expect(body).not.toContainText('page.title')
    await expect(body).not.toContainText('config.cardCountHint')
  })
})
