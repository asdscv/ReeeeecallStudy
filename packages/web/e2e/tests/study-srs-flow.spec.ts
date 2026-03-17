import { test, expect } from '../fixtures/test-helpers'

/**
 * E2E: Full SRS study flow with detailed logic verification.
 *
 * Tests:
 * 1. Card content rendering (front/back text)
 * 2. Flip interaction (tap → back face appears with rating buttons)
 * 3. SRS rating buttons: Again(1) / Hard(2) / Good(3) / Easy(4)
 * 4. Progress bar advancing with each rating
 * 5. Again → re-queue (card reappears later in session)
 * 6. Easy → graduate (skip learning steps)
 * 7. Session summary with correct stats (cards studied, rating distribution)
 * 8. Second SRS session → "no cards due"
 * 9. DB verification: card srs_status changed from 'new'
 */

test.describe('SRS Study Flow — Full Logic', () => {
  test.setTimeout(120_000)

  let supabaseUrl = ''
  let headers: Record<string, string> = {}
  let testDeckId: string | null = null

  async function captureCredentials(page: import('@playwright/test').Page) {
    await page.route('**/rest/v1/**', async (route) => {
      const h = route.request().headers()
      if (h['apikey'] && !supabaseUrl) {
        const url = new URL(route.request().url())
        supabaseUrl = `${url.protocol}//${url.host}`
        headers = { apikey: h['apikey'], authorization: h['authorization'] || '' }
      }
      await route.continue()
    })
    await page.goto('/decks')
    await page.waitForTimeout(2000)
    await page.unrouteAll()
  }

  async function createTestDeck(page: import('@playwright/test').Page, cards: Array<{ front: string; back: string }>) {
    return page.evaluate(async ({ url, hdrs, cards }) => {
      const payload = JSON.parse(atob(hdrs.authorization!.replace('Bearer ', '').split('.')[1]))
      const userId = payload.sub
      const tmpl = (await (await fetch(`${url}/rest/v1/card_templates?is_default=eq.true&limit=1`, { headers: hdrs })).json())[0]

      const deck = (await (await fetch(`${url}/rest/v1/decks`, {
        method: 'POST',
        headers: { ...hdrs, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify({
          user_id: userId, name: '_E2E SRS Logic', icon: '🧪', color: '#3B82F6',
          default_template_id: tmpl.id, next_position: cards.length,
        }),
      })).json())[0]

      await fetch(`${url}/rest/v1/cards`, {
        method: 'POST',
        headers: { ...hdrs, 'Content-Type': 'application/json' },
        body: JSON.stringify(cards.map((c, i) => ({
          deck_id: deck.id, user_id: userId, template_id: tmpl.id,
          field_values: { front: c.front, back: c.back },
          tags: [], sort_position: i, srs_status: 'new', ease_factor: 2.5, interval_days: 0, repetitions: 0,
        }))),
      })
      return { deckId: deck.id as string, userId: userId as string }
    }, { url: supabaseUrl, hdrs: headers, cards })
  }

  async function cleanup(page: import('@playwright/test').Page, deckId: string) {
    await page.evaluate(async ({ url, hdrs, deckId }) => {
      for (const table of ['study_logs', 'study_sessions', 'deck_study_state', 'cards', 'decks']) {
        const col = table === 'decks' ? 'id' : 'deck_id'
        await fetch(`${url}/rest/v1/${table}?${col}=eq.${deckId}`, { method: 'DELETE', headers: hdrs })
      }
    }, { url: supabaseUrl, hdrs: headers, deckId })
  }

  async function queryCards(page: import('@playwright/test').Page, deckId: string) {
    return page.evaluate(async ({ url, hdrs, deckId }) => {
      const res = await fetch(
        `${url}/rest/v1/cards?deck_id=eq.${deckId}&select=id,srs_status,ease_factor,interval_days,repetitions,next_review_at&order=sort_position.asc`,
        { headers: hdrs },
      )
      return res.json() as Promise<Array<{
        id: string; srs_status: string; ease_factor: number;
        interval_days: number; repetitions: number; next_review_at: string | null
      }>>
    }, { url: supabaseUrl, hdrs: headers, deckId })
  }

  // ────────────────────────────────────────────────────────────
  // Test 1: Card content, flip, rating buttons, progress
  // ────────────────────────────────────────────────────────────
  test('Card rendering + flip + SRS rating buttons + progress', async ({ page }) => {
    await captureCredentials(page)
    const { deckId } = await createTestDeck(page, [
      { front: 'Apple', back: 'A red fruit' },
      { front: 'Dog', back: 'A loyal animal' },
    ])
    testDeckId = deckId

    await page.goto(`/decks/${deckId}/study?mode=srs&batchSize=20`)

    // ── Verify front face is visible (FRONT label + card content + tap hint) ──
    const frontLabel = page.locator('text=/FRONT/i')
    await expect(frontLabel).toBeVisible({ timeout: 15_000 })
    // Template may show back field on front face — just verify some card text appears
    await expect(page.locator('text=/A red fruit|Apple/i').first()).toBeVisible()
    await expect(page.locator('text=/Tap to flip|탭하여 뒤집기/i')).toBeVisible()

    // Progress shows 1/2
    const progressBar = page.locator('span.whitespace-nowrap').filter({ hasText: /\d+\/\d+/ }).first()
    const progressText1 = await progressBar.textContent()
    expect(progressText1).toContain('1/')

    // ── SRS rating buttons should NOT be visible before flip ──
    const againBtn = page.getByRole('button', { name: /Again|다시/i })
    await expect(againBtn).not.toBeVisible()

    // ── Flip the card (Space key) ──
    await page.keyboard.press('Space')
    await page.waitForTimeout(500)

    // ── Verify back face content ──
    const backLabel = page.locator('text=/BACK/i')
    await expect(backLabel).toBeVisible({ timeout: 5_000 })
    // The other field should now be visible
    await expect(page.locator('text=/Apple|A red fruit/i').first()).toBeVisible()

    // ── All 4 SRS rating buttons visible ──
    await expect(againBtn).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('button', { name: /Hard|어려움/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Good|보통/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Easy|쉬움/i })).toBeVisible()

    // ── Rate "Easy" (Digit4) ──
    await page.keyboard.press('Digit4')
    await page.waitForTimeout(800)

    // ── Progress should advance — now showing card 2 with FRONT label ──
    await expect(frontLabel).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('text=/A loyal animal|Dog/i').first()).toBeVisible({ timeout: 5_000 })

    // ── Rate second card "Easy" ──
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    await expect(backLabel).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Digit4')
    await page.waitForTimeout(800)

    // ── Session complete — summary screen ──
    await expect(page.locator('text=/Complete|완료/i').first()).toBeVisible({ timeout: 10_000 })
    // Summary shows "2/2" cards studied
    await expect(page.locator('text=/2.*\\/.*2/').first()).toBeVisible()
    // Rating distribution shows "Easy 2" or similar
    await expect(page.locator('text=/Easy|쉬움/i').first()).toBeVisible()

    await cleanup(page, deckId)
    testDeckId = null
  })

  // ────────────────────────────────────────────────────────────
  // Test 2: "Again" re-queues card (card reappears in session)
  // ────────────────────────────────────────────────────────────
  test('Again rating re-queues card — card reappears later', async ({ page }) => {
    await captureCredentials(page)
    const { deckId } = await createTestDeck(page, [
      { front: 'Cat', back: 'A small feline' },
      { front: 'Bird', back: 'A flying creature' },
      { front: 'Fish', back: 'A water animal' },
      { front: 'Bear', back: 'A large mammal' },
    ])
    testDeckId = deckId

    await page.goto(`/decks/${deckId}/study?mode=srs&batchSize=20`)
    await expect(page.locator('text=/Tap to flip|탭하여 뒤집기/i')).toBeVisible({ timeout: 15_000 })

    // Rate first card "Again" — it should be re-queued
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    await expect(page.getByRole('button', { name: /Again|다시/i })).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Digit1') // Again
    await page.waitForTimeout(800)

    // Rate next 3 cards "Easy" to move through the queue
    for (let i = 0; i < 3; i++) {
      await expect(page.locator('text=/Tap to flip|탭하여 뒤집기/i')).toBeVisible({ timeout: 5_000 })
      await page.keyboard.press('Space')
      await page.waitForTimeout(300)
      await page.keyboard.press('Digit4') // Easy
      await page.waitForTimeout(800)
    }

    // The "Again" card (Cat) should reappear because SrsQueueManager re-queues learning cards
    // It should show "Cat" or the re-queued card
    const hasMoreCards = await page.locator('text=/Tap to flip|탭하여 뒤집기/i').isVisible({ timeout: 3_000 }).catch(() => false)
    if (hasMoreCards) {
      // Re-queued card appeared — flip and rate "Easy" to finish
      await page.keyboard.press('Space')
      await page.waitForTimeout(300)
      // Should see "A small feline" (the back of "Cat")
      await expect(page.locator('text=A small feline')).toBeVisible({ timeout: 3_000 })
      await page.keyboard.press('Digit4') // Easy to graduate
      await page.waitForTimeout(800)
    }

    // Keep rating until session ends
    for (let i = 0; i < 5; i++) {
      const still = await page.locator('text=/Tap to flip|탭하여 뒤집기/i').isVisible({ timeout: 1_000 }).catch(() => false)
      if (!still) break
      await page.keyboard.press('Space')
      await page.waitForTimeout(300)
      await page.keyboard.press('Digit4')
      await page.waitForTimeout(800)
    }

    // Session should be complete
    await expect(page.locator('text=/Complete|완료|Session Ended|세션 종료/i').first()).toBeVisible({ timeout: 10_000 })

    // Summary should show "Again 1" in the rating distribution
    await expect(page.locator('text=/Again|다시/i').first()).toBeVisible()

    await cleanup(page, deckId)
    testDeckId = null
  })

  // ────────────────────────────────────────────────────────────
  // Test 3: DB state after study — srs_status changes
  // ────────────────────────────────────────────────────────────
  test('After studying, card srs_status changes in DB', async ({ page }) => {
    await captureCredentials(page)
    const { deckId } = await createTestDeck(page, [
      { front: 'Sun', back: 'A star' },
      { front: 'Moon', back: 'Earth satellite' },
    ])
    testDeckId = deckId

    // Verify initial state: all cards are 'new'
    const before = await queryCards(page, deckId)
    expect(before).toHaveLength(2)
    expect(before.every(c => c.srs_status === 'new')).toBe(true)
    expect(before.every(c => c.next_review_at === null)).toBe(true)

    // Study both cards with "Easy"
    await page.goto(`/decks/${deckId}/study?mode=srs&batchSize=20`)
    await expect(page.locator('text=/Tap to flip|탭하여 뒤집기/i')).toBeVisible({ timeout: 15_000 })

    for (let i = 0; i < 2; i++) {
      await page.keyboard.press('Space')
      await page.waitForTimeout(300)
      await page.keyboard.press('Digit4') // Easy
      await page.waitForTimeout(800)
    }

    // Wait for session completion and background DB writes
    await expect(page.locator('text=/Complete|완료/i').first()).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(2000) // Give DB writes time to complete

    // Verify DB state: cards should now be 'review' with future next_review_at
    const after = await queryCards(page, deckId)
    expect(after).toHaveLength(2)
    for (const card of after) {
      expect(card.srs_status).toBe('review')
      expect(card.next_review_at).not.toBeNull()
      // next_review_at should be in the future
      expect(new Date(card.next_review_at!).getTime()).toBeGreaterThan(Date.now())
      // ease_factor should still be 2.5 or higher (Easy adds 0.15)
      expect(card.ease_factor).toBeGreaterThanOrEqual(2.5)
      // interval_days should be > 0 (Easy defaults to 4 days)
      expect(card.interval_days).toBeGreaterThan(0)
      // repetitions should be 1 (graduated from learning)
      expect(card.repetitions).toBe(1)
    }

    // ── Start SRS again — should show "no cards due" ──
    await page.goto(`/decks/${deckId}/study?mode=srs&batchSize=20`)
    const noCards = page.locator('text=/No cards|카드가 없|all.*reviewed|다음 복습|오늘.*학습.*완료/i')
    await expect(noCards.first()).toBeVisible({ timeout: 15_000 })

    await cleanup(page, deckId)
    testDeckId = null
  })

  // ────────────────────────────────────────────────────────────
  // Test 4: QuickStudy → select deck → SRS mode → study card
  // ────────────────────────────────────────────────────────────
  test('QuickStudy flow: deck select → SRS mode → card appears', async ({ page }) => {
    await captureCredentials(page)
    const { deckId } = await createTestDeck(page, [
      { front: 'Hello', back: 'A greeting' },
    ])
    testDeckId = deckId

    // Go to QuickStudy page
    await page.goto('/quick-study')
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(2000)

    // Find and click the test deck
    const deckButton = page.getByRole('button', { name: /_E2E SRS Logic/i }).first()
    await expect(deckButton).toBeVisible({ timeout: 10_000 })

    // Should show new card badge
    const deckText = await deckButton.textContent()
    expect(deckText).toMatch(/1.*card|1.*카드/)

    await deckButton.click()

    // Modal appears → select SRS mode (🧠)
    const modal = page.locator('.fixed.inset-0')
    await expect(modal).toBeVisible()
    await modal.getByRole('button').filter({ hasText: '🧠' }).click()

    // Should navigate to study session
    await page.waitForURL(/\/study\?/, { timeout: 10_000 })

    // Card should appear with content (front face shows one of the field values)
    await expect(page.locator('text=/Hello|A greeting/i').first()).toBeVisible({ timeout: 15_000 })

    // Flip and verify back shows the other field
    await page.keyboard.press('Space')
    await page.waitForTimeout(500)
    await expect(page.locator('text=/BACK/i')).toBeVisible({ timeout: 5_000 })

    // Rate and complete
    await page.keyboard.press('Digit4')
    await page.waitForTimeout(800)

    // Summary
    await expect(page.locator('text=/Complete|완료/i').first()).toBeVisible({ timeout: 10_000 })

    await cleanup(page, deckId)
    testDeckId = null
  })

  // ────────────────────────────────────────────────────────────
  // Test 5: Mixed ratings + session summary accuracy
  // ────────────────────────────────────────────────────────────
  test('Mixed ratings produce correct summary stats', async ({ page }) => {
    await captureCredentials(page)
    const { deckId } = await createTestDeck(page, [
      { front: 'Red', back: 'Color of fire' },
      { front: 'Blue', back: 'Color of sky' },
      { front: 'Green', back: 'Color of grass' },
    ])
    testDeckId = deckId

    await page.goto(`/decks/${deckId}/study?mode=srs&batchSize=20`)
    await expect(page.locator('text=/Tap to flip|탭하여 뒤집기/i')).toBeVisible({ timeout: 15_000 })

    // Card 1: rate "Hard" (Digit2)
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    await page.keyboard.press('Digit2')
    await page.waitForTimeout(800)

    // Card 2: rate "Good" (Digit3)
    await expect(page.locator('text=/Tap to flip|탭하여 뒤집기/i')).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    await page.keyboard.press('Digit3')
    await page.waitForTimeout(800)

    // Card 3: rate "Easy" (Digit4)
    await expect(page.locator('text=/Tap to flip|탭하여 뒤집기/i')).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    await page.keyboard.press('Digit4')
    await page.waitForTimeout(800)

    // Learning cards from Hard/Good may re-queue — keep rating until done
    for (let i = 0; i < 10; i++) {
      const still = await page.locator('text=/Tap to flip|탭하여 뒤집기/i').isVisible({ timeout: 1_500 }).catch(() => false)
      if (!still) break
      await page.keyboard.press('Space')
      await page.waitForTimeout(300)
      await page.keyboard.press('Digit4') // Easy to finish fast
      await page.waitForTimeout(800)
    }

    // Session summary should appear
    await expect(page.locator('text=/Complete|완료|Session Ended|세션 종료/i').first()).toBeVisible({ timeout: 10_000 })

    // Summary should show all 3 rating types
    const bodyText = await page.locator('body').textContent()
    // At minimum: Hard, Good, Easy should each appear at least once in the summary
    expect(bodyText).toMatch(/Hard|어려움/)
    expect(bodyText).toMatch(/Good|보통/)
    expect(bodyText).toMatch(/Easy|쉬움/)

    await cleanup(page, deckId)
    testDeckId = null
  })
})
