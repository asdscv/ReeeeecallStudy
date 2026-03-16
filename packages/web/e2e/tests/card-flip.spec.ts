import { test, expect } from '../fixtures/test-helpers'

test.describe('Card Flip — Visibility & Animation', () => {

  /**
   * Helper: navigate to quick-study, select deck + random mode, start study.
   * Returns false if no cards are available.
   */
  async function setupStudySession(
    quickStudyPage: any,
    page: any,
  ): Promise<boolean> {
    await quickStudyPage.navigate()
    await quickStudyPage.selectFirstDeck()
    await quickStudyPage.selectMode('🎲')
    await quickStudyPage.startStudy()
    await page.waitForURL(/\/study\?/, { timeout: 10_000 })
    await page.waitForTimeout(2000)

    const noCards = await page.locator('text=/No cards|카드가 없/i').isVisible().catch(() => false)
    return !noCards
  }

  test('Card remains visible after flip (not stuck at opacity 0)', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await setupStudySession(quickStudyPage, page)
    if (!hasCards) { test.skip(true, 'No cards in deck'); return }

    // Front face should be visible
    const card = studySessionPage.cardContainer
    await expect(card).toBeVisible()

    // Get card opacity before flip — should be 1
    const opacityBefore = await card.evaluate(
      (el: HTMLElement) => getComputedStyle(el).opacity,
    )
    expect(opacityBefore).toBe('1')

    // Flip the card
    await studySessionPage.flipCard()

    // Wait for fade animation to complete (150ms fade out + 150ms fade in)
    await page.waitForTimeout(500)

    // Card must still be visible after flip
    await expect(card).toBeVisible()

    // Opacity must be 1 (not stuck at 0 from the isFading bug)
    const opacityAfter = await card.evaluate(
      (el: HTMLElement) => getComputedStyle(el).opacity,
    )
    expect(opacityAfter).toBe('1')
  })

  test('Back face content renders after flip', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await setupStudySession(quickStudyPage, page)
    if (!hasCards) { test.skip(true, 'No cards in deck'); return }

    // Front face should show "Tap to flip" hint
    const frontHint = page.locator('text=/Tap to flip|탭하여 뒤집기|눌러서/i')
    await expect(frontHint).toBeVisible({ timeout: 3000 })

    // Flip
    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    // After flip: "BACK" label or rating buttons should appear
    const backLabel = page.locator('text=/BACK|뒷면/i')
    const ratingButton = page.getByRole('button', { name: /Again|Good|다시|좋음|Got It|알겠어요/i }).first()

    // Either back label or rating buttons must be visible
    const backVisible = await backLabel.isVisible({ timeout: 3000 }).catch(() => false)
    const ratingVisible = await ratingButton.isVisible({ timeout: 1000 }).catch(() => false)

    expect(backVisible || ratingVisible).toBe(true)
  })

  test('Card transform is clean when idle (no residual 3D)', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await setupStudySession(quickStudyPage, page)
    if (!hasCards) { test.skip(true, 'No cards in deck'); return }

    const card = studySessionPage.cardContainer
    await expect(card).toBeVisible()

    // Check that card body has no 3D transforms when idle
    const styles = await card.evaluate((el: HTMLElement) => {
      const computed = getComputedStyle(el)
      return {
        transform: computed.transform,
        perspective: computed.perspective,
        transformStyle: computed.transformStyle,
        backfaceVisibility: computed.backfaceVisibility,
      }
    })

    // No 3D properties should be set
    expect(styles.perspective).toMatch(/^(none|)$/)
    expect(styles.transformStyle).toMatch(/^(flat|)$/)
    expect(styles.backfaceVisibility).toMatch(/^(visible|)$/)
    // Transform should be none or identity matrix (no 3D)
    if (styles.transform !== 'none') {
      expect(styles.transform).not.toMatch(/matrix3d|perspective|rotateY|rotateX/)
    }
  })

  test('Multiple flip cycles work correctly', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await setupStudySession(quickStudyPage, page)
    if (!hasCards) { test.skip(true, 'No cards in deck'); return }

    const card = studySessionPage.cardContainer

    // Flip 3 times and verify card stays visible each time
    for (let i = 0; i < 3; i++) {
      await studySessionPage.flipCard()
      await page.waitForTimeout(400)

      await expect(card).toBeVisible()
      const opacity = await card.evaluate(
        (el: HTMLElement) => getComputedStyle(el).opacity,
      )
      expect(opacity).toBe('1')
    }
  })
})

test.describe('Card Flip — Mobile Viewport', () => {
  test.use({ viewport: { width: 393, height: 851 } })

  test('Card visible after flip on mobile viewport', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    await quickStudyPage.navigate()
    await quickStudyPage.selectFirstDeck()
    await quickStudyPage.selectMode('🎲')
    await quickStudyPage.startStudy()
    await page.waitForURL(/\/study\?/, { timeout: 10_000 })
    await page.waitForTimeout(2000)

    const noCards = await page.locator('text=/No cards|카드가 없/i').isVisible().catch(() => false)
    if (noCards) { test.skip(true, 'No cards in deck'); return }

    const card = studySessionPage.cardContainer
    await expect(card).toBeVisible()

    // Flip on mobile
    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    // Card must be visible (not opacity 0)
    await expect(card).toBeVisible()
    const opacity = await card.evaluate(
      (el: HTMLElement) => getComputedStyle(el).opacity,
    )
    expect(opacity).toBe('1')

    // Rating buttons or back label must appear
    const hasContent = await page
      .locator('text=/BACK|뒷면|Again|Good|다시|좋음|Got It|알겠어요/i')
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false)
    expect(hasContent).toBe(true)
  })
})
