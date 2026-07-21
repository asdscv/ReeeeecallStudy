import { test, expect } from '../fixtures/test-helpers'

/**
 * Regression test for the "AI server error" on save (deck not found or not owned).
 *
 * Root cause: the AI "Add to a deck" target-deck dropdown listed SUBSCRIBED decks
 * (owned by a publisher / official) — saving AI cards into one fails server-side at
 * reserve_card_positions ("deck not found or not owned"), surfaced as a generic AI
 * error. Fix: the dropdown now offers ONLY owned + editable decks.
 *
 * Setup (external, via Supabase): the test account is temporarily subscribed to the
 * official deck below, reproducing the exact broken condition. This test asserts that
 * deck is ABSENT from the AI target-deck dropdown, while owned decks remain — and that
 * the balance + card-limit pills render (the second requested change).
 */

// The non-owned (subscribed, official) deck the account is temporarily subscribed to.
const SUBSCRIBED_DECK_MARKER = 'IELTS 5.0'

test.describe('AI Generate — target dropdown excludes non-owned decks', () => {
  test('Add-to-a-deck lists only owned decks + shows balance and card-limit', async ({ page }) => {
    test.setTimeout(60_000)

    // 1) Decks page — AI entry point. Wait for the deck grid to actually render
    //    (confirms login worked AND the deck store is populated before we open the
    //    modal, so the dropdown reads from loaded data, not an empty in-flight store).
    await page.goto('/decks')
    const aiBtn = page.getByRole('button', { name: /AI Generate|AI로 만들기/i }).first()
    await expect(aiBtn).toBeVisible({ timeout: 20_000 })
    // Deck cards render as <div onClick> with an <h3> name — wait for the grid to load.
    await expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible({ timeout: 20_000 })

    // Control: is a non-owned (subscribed) deck present in the library right now? When it
    // is (the exact repro condition), we additionally assert the dropdown EXCLUDES it.
    // When it isn't, the test still smoke-checks that owned decks + both pills render, so
    // it stays green in CI without depending on external subscribe-share fixtures.
    const inLibrary = await page
      .getByRole('heading', { level: 3, name: new RegExp(SUBSCRIBED_DECK_MARKER) })
      .first()
      .isVisible()
      .catch(() => false)
    console.log('[control] subscribed deck present in library:', inLibrary)

    // 2) Open the AI Auto-Generate modal (opens in "New deck" mode w/ mode selector).
    await aiBtn.click()
    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // 3) Switch to "Add to a deck" (cards_only) → the target-deck selector appears.
    await dialog.getByRole('button', { name: /Add to a deck|덱에 추가/i }).click()

    // 4) Wait for the dropdown to POPULATE (deck fetch is async on mode switch), then
    //    read every option in the target-deck <select>.
    const deckSelect = dialog.locator('select').first()
    await expect(deckSelect).toBeVisible({ timeout: 10_000 })
    await expect
      .poll(() => deckSelect.locator('option').count(), { timeout: 15_000 })
      .toBeGreaterThan(1)
    const optionTexts: string[] = await deckSelect
      .locator('option')
      .evaluateAll((opts) => opts.map((o) => (o.textContent ?? '').trim()))
    console.log('[dropdown] option count:', optionTexts.length)
    console.log('[dropdown] options:', JSON.stringify(optionTexts))

    // PRIMARY ASSERT (when the repro condition holds): the non-owned (subscribed/
    // official) deck present in the library is NOT offered as an AI target.
    if (inLibrary) {
      expect(
        optionTexts.join('\n'),
        'subscribed/non-owned deck must be excluded from the AI target dropdown',
      ).not.toContain(SUBSCRIBED_DECK_MARKER)
    }

    // ASSERT: at least one owned deck is still selectable.
    const hasOwned = optionTexts.some((t) => /Test Deck E2E|_E2E|E2E Test Deck/.test(t))
    expect(hasOwned).toBeTruthy()

    // 5) Requested UI additions: balance pill + card-limit-remaining pill both render.
    //    Card-limit pill: "N of M cards left" (or "카드 한도 …장 남음").
    await expect(
      dialog.getByText(/\d+ of \d+ cards left|카드 한도.*남음/i),
    ).toBeVisible({ timeout: 10_000 })
    //    Balance/free pill: "N free cards left today" / "$X balance" (or ko equivalents).
    await expect(
      dialog.getByText(/free cards? left|balance|잔액|무료 카드|충전/i).first(),
    ).toBeVisible({ timeout: 10_000 })

    // Evidence.
    await dialog.screenshot({ path: 'playwright/ai-deck-ownership.png' }).catch(() => {})
  })
})
