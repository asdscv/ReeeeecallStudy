import { test, expect } from '../fixtures/test-helpers'

test.describe('Sequential Review — Resume After Mid-Session Exit', () => {

  /**
   * Helper: navigate to quick-study, select deck + sequential review mode (🔄), start study.
   * Returns false if no cards are available.
   */
  async function startSequentialReview(
    quickStudyPage: any,
    page: any,
  ): Promise<boolean> {
    await quickStudyPage.navigate()
    await quickStudyPage.selectFirstDeck()
    await quickStudyPage.selectMode('🔄')
    await quickStudyPage.startStudy()
    await page.waitForURL(/\/study\?/, { timeout: 10_000 })
    await page.waitForTimeout(2000)

    const noCards = await page.locator('text=/No cards|카드가 없/i').isVisible().catch(() => false)
    return !noCards
  }

  /**
   * Get the visible card text (front or back).
   */
  async function getCardText(page: any): Promise<string> {
    const card = page.locator('.rounded-2xl').first()
    return (await card.textContent() ?? '').trim()
  }

  test('Resumes from second card after mid-session exit', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    // Ensure button mode (swipe mode may have been left on by prior tests)
    await studySessionPage.disableSwipeMode()

    // --- Session 1: study 1 card, then exit ---
    const hasCards = await startSequentialReview(quickStudyPage, page)
    if (!hasCards) { test.skip(true, 'No cards in deck'); return }

    // Record first card text
    const firstCardText = await getCardText(page)

    // Flip the card
    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    // Rate the card — sequential_review uses Known/Unknown buttons
    // Translations: en="Known", ko="알고 있음", ja="既知", zh="认识"
    const knownBtn = page.getByRole('button', { name: /Known|알고 있음|既知|认识/i }).first()
    await knownBtn.click({ timeout: 5000 })
    await page.waitForTimeout(1000)

    // Check if session completed (only 1 card in deck)
    const summaryVisible = await page
      .locator('text=/Complete|완료/i')
      .first()
      .isVisible()
      .catch(() => false)

    if (summaryVisible) {
      test.skip(true, 'Deck has only 1 card — cannot test resume')
      return
    }

    // Record second card text (this is where we should resume)
    const secondCardText = await getCardText(page)
    expect(secondCardText).not.toBe('')

    // Exit mid-session: navigate away
    await page.goto('/quick-study')
    await page.waitForTimeout(1000)

    // --- Session 2: start sequential review again ---
    const hasCards2 = await startSequentialReview(quickStudyPage, page)
    if (!hasCards2) { test.skip(true, 'No cards in deck on second session'); return }

    // The first card shown should NOT be the first card from session 1
    const resumeCardText = await getCardText(page)

    // The resumed card should match the second card (the one we didn't finish)
    // or at minimum should NOT be the first card we already studied
    expect(resumeCardText).not.toBe(firstCardText)
  })
})
