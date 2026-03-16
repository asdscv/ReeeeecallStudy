import { test, expect } from '../fixtures/test-helpers'

test.describe('Swipe Mode — Card Gestures', () => {

  /**
   * Helper: navigate to quick-study, enable swipe mode, select deck + random mode, start study.
   * Returns false if no cards are available (test should skip).
   */
  async function setupSwipeSession(
    quickStudyPage: Awaited<ReturnType<typeof import('../fixtures/test-helpers')['test']['step']>> extends never ? never : any,
    studySessionPage: any,
    page: any,
  ): Promise<boolean> {
    await quickStudyPage.navigate()
    // Enable swipe mode AFTER navigation (so localStorage is accessible)
    await studySessionPage.enableSwipeMode()
    await quickStudyPage.selectFirstDeck()
    await quickStudyPage.selectMode('🎲')
    await quickStudyPage.startStudy()
    await page.waitForURL(/\/study\?/, { timeout: 10_000 })
    await page.waitForTimeout(2000)

    const noCards = await page.locator('text=/No cards|카드가 없/i').isVisible().catch(() => false)
    return !noCards
  }

  test('Swipe right (good) advances to next card', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await setupSwipeSession(quickStudyPage, studySessionPage, page)
    if (!hasCards) { test.skip(true, 'No cards in deck'); return }

    // Flip the card first
    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    // Swipe hint should be visible in swipe mode
    await expect(studySessionPage.swipeHint).toBeVisible({ timeout: 3000 })

    // Swipe right (= 'good' rating)
    await studySessionPage.swipeCard('right', 80)
    await page.waitForTimeout(800)

    // After swipe: should show next card's front face or summary
    const summaryVisible = await page
      .locator('text=/Complete|완료/i')
      .first()
      .isVisible()
      .catch(() => false)

    if (!summaryVisible) {
      const flipHint = page.locator('text=/Tap to flip|탭하여 뒤집기|눌러서/i')
      await expect(flipHint).toBeVisible({ timeout: 3000 })
    }
  })

  test('Swipe left (again) advances to next card', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await setupSwipeSession(quickStudyPage, studySessionPage, page)
    if (!hasCards) { test.skip(true, 'No cards in deck'); return }

    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    // Swipe left (= 'again' rating)
    await studySessionPage.swipeCard('left', 80)
    await page.waitForTimeout(800)

    const summaryVisible = await page
      .locator('text=/Complete|완료/i')
      .first()
      .isVisible()
      .catch(() => false)

    if (!summaryVisible) {
      const flipHint = page.locator('text=/Tap to flip|탭하여 뒤집기|눌러서/i')
      await expect(flipHint).toBeVisible({ timeout: 3000 })
    }
  })

  test('Short swipe (below threshold) does NOT advance card', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await setupSwipeSession(quickStudyPage, studySessionPage, page)
    if (!hasCards) { test.skip(true, 'No cards in deck'); return }

    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    // Get the progress text before short swipe
    const progressBefore = await page.locator('text=/\\d+\\/\\d+/').first().textContent().catch(() => '')

    // Very short swipe — should NOT trigger rating (20px < 50px threshold)
    // Note: small mouse movement also fires a click, which may flip card back
    await studySessionPage.swipeCard('right', 20)
    await page.waitForTimeout(500)

    // Verify the card did NOT advance (progress unchanged, no summary)
    const summaryVisible = await page
      .locator('text=/Complete|완료/i')
      .first()
      .isVisible()
      .catch(() => false)
    expect(summaryVisible).toBe(false)

    const progressAfter = await page.locator('text=/\\d+\\/\\d+/').first().textContent().catch(() => '')
    expect(progressAfter).toBe(progressBefore)
  })

  test('Swipe overlay color does NOT persist on next card', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await setupSwipeSession(quickStudyPage, studySessionPage, page)
    if (!hasCards) { test.skip(true, 'No cards in deck'); return }

    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    // Swipe right to advance
    await studySessionPage.swipeCard('right', 80)
    await page.waitForTimeout(800)

    const summaryVisible = await page
      .locator('text=/Complete|완료/i')
      .first()
      .isVisible()
      .catch(() => false)

    if (!summaryVisible) {
      // No color overlay on the new card's front face
      const overlay = studySessionPage.swipeOverlay
      const overlayVisible = await overlay.isVisible({ timeout: 300 }).catch(() => false)
      expect(overlayVisible).toBe(false)
    }
  })

  test('Rating buttons are hidden in swipe mode', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await setupSwipeSession(quickStudyPage, studySessionPage, page)
    if (!hasCards) { test.skip(true, 'No cards in deck'); return }

    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    // In swipe mode, no SRS/rating buttons should be visible
    const gotItVisible = await page
      .getByRole('button', { name: /Good|좋아요|Got It|알겠어요/i })
      .isVisible({ timeout: 500 })
      .catch(() => false)
    expect(gotItVisible).toBe(false)
  })

  test('Swipe does NOT advance card when on front face', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await setupSwipeSession(quickStudyPage, studySessionPage, page)
    if (!hasCards) { test.skip(true, 'No cards in deck'); return }

    // Get progress before — card is on front face
    const progressBefore = await page.locator('text=/\\d+\\/\\d+/').first().textContent().catch(() => '')

    // Swipe on front face — should NOT trigger rating (swipe is disabled on front)
    // Note: the swipe gesture may also trigger a click, flipping the card
    await studySessionPage.swipeCard('right', 80)
    await page.waitForTimeout(500)

    // Verify the card did NOT advance (progress unchanged, no summary)
    const summaryVisible = await page
      .locator('text=/Complete|완료/i')
      .first()
      .isVisible()
      .catch(() => false)
    expect(summaryVisible).toBe(false)

    const progressAfter = await page.locator('text=/\\d+\\/\\d+/').first().textContent().catch(() => '')
    expect(progressAfter).toBe(progressBefore)
  })
})

test.describe('Swipe Mode — Overlay Visibility', () => {

  async function setupSwipeSession(
    quickStudyPage: any,
    studySessionPage: any,
    page: any,
  ): Promise<boolean> {
    await quickStudyPage.navigate()
    await studySessionPage.enableSwipeMode()
    await quickStudyPage.selectFirstDeck()
    await quickStudyPage.selectMode('🎲')
    await quickStudyPage.startStudy()
    await page.waitForURL(/\/study\?/, { timeout: 10_000 })
    await page.waitForTimeout(2000)
    const noCards = await page.locator('text=/No cards|카드가 없/i').isVisible().catch(() => false)
    return !noCards
  }

  test('Swipe overlay NOT visible below threshold', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await setupSwipeSession(quickStudyPage, studySessionPage, page)
    if (!hasCards) { test.skip(true, 'No cards in deck'); return }

    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    // Swipe 20px right (below SWIPE_THRESHOLD of 30px) and HOLD
    const card = studySessionPage.cardContainer
    const box = await card.boundingBox()
    if (!box) { test.skip(true, 'Card not visible'); return }

    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(cx + (20 / 5) * i, cy)
      await page.waitForTimeout(20)
    }
    // Hold — check overlay is NOT visible
    await page.waitForTimeout(100)
    const overlayVisible = await studySessionPage.swipeOverlay.isVisible({ timeout: 300 }).catch(() => false)
    expect(overlayVisible).toBe(false)

    await page.mouse.up()
  })

  test('Swipe overlay visible at threshold', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await setupSwipeSession(quickStudyPage, studySessionPage, page)
    if (!hasCards) { test.skip(true, 'No cards in deck'); return }

    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    // Swipe 80px right (well above SWIPE_THRESHOLD of 30px) and HOLD
    const card = studySessionPage.cardContainer
    const box = await card.boundingBox()
    if (!box) { test.skip(true, 'Card not visible'); return }

    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(cx + (80 / 5) * i, cy)
      await page.waitForTimeout(20)
    }
    // Hold — check overlay IS visible
    await page.waitForTimeout(100)
    const overlay = studySessionPage.swipeOverlay
    await expect(overlay).toBeVisible({ timeout: 1000 })

    await page.mouse.up()
  })
})

test.describe('Swipe Mode — Mobile Viewport', () => {
  test.use({ viewport: { width: 393, height: 851 } })

  test('Swipe works on narrow mobile viewport', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    await quickStudyPage.navigate()
    await studySessionPage.enableSwipeMode()
    await quickStudyPage.selectFirstDeck()

    // On mobile viewport, mode selection might require scrolling
    await quickStudyPage.selectMode('🎲')

    await quickStudyPage.startStudy()
    await page.waitForURL(/\/study\?/, { timeout: 10_000 })
    await page.waitForTimeout(2000)

    const noCards = await page.locator('text=/No cards|카드가 없/i').isVisible().catch(() => false)
    if (noCards) { test.skip(true, 'No cards in deck'); return }

    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    // Swipe right with moderate distance
    await studySessionPage.swipeCard('right', 70)
    await page.waitForTimeout(800)

    const summaryVisible = await page
      .locator('text=/Complete|완료/i')
      .first()
      .isVisible()
      .catch(() => false)

    if (!summaryVisible) {
      const flipHint = page.locator('text=/Tap to flip|탭하여 뒤집기|눌러서/i')
      await expect(flipHint).toBeVisible({ timeout: 3000 })
    }
  })
})
