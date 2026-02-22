import { test, expect } from '../fixtures/test-helpers'

test.describe('Button Rating — unknown/known buttons in all non-SRS modes', () => {

  test('Random mode shows unknown/known buttons (not next)', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    await quickStudyPage.navigate()
    await quickStudyPage.selectFirstDeck()

    // Select random mode (🎲)
    await quickStudyPage.selectMode('🎲')
    await quickStudyPage.startStudy()

    await page.waitForURL(/\/study\?/, { timeout: 10_000 })
    await page.waitForTimeout(2000)

    const noCards = await page.locator('text=/No cards|카드가 없/i').isVisible().catch(() => false)
    if (noCards) {
      test.skip(true, 'No cards in deck — skipping')
      return
    }

    // Flip the card
    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    // unknown/known buttons should be visible
    await expect(studySessionPage.unknownButton).toBeVisible({ timeout: 5000 })
    await expect(studySessionPage.knownButton).toBeVisible({ timeout: 5000 })

    // "Next" button should NOT be present
    await expect(studySessionPage.nextButton).not.toBeVisible()
  })

  test('Known button click advances to next card', async ({
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
    if (noCards) {
      test.skip(true, 'No cards in deck — skipping')
      return
    }

    // Flip → rate known
    await studySessionPage.flipAndRateKnown()
    await page.waitForTimeout(500)

    // Card should have advanced — should be back to front side (tap-to-flip hint visible)
    const frontHint = page.locator('text=/Tap to flip|탭하여 뒤집기/i')
    const summary = page.locator('text=/Complete|완료/i')
    // Either we see the next card's front, or session is complete (only 1 card)
    await expect(frontHint.or(summary).first()).toBeVisible({ timeout: 5000 })
  })

  test('Keyboard ArrowLeft triggers unknown rating', async ({
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
    if (noCards) {
      test.skip(true, 'No cards in deck — skipping')
      return
    }

    // Flip with keyboard
    await page.keyboard.press('Space')
    await page.waitForTimeout(500)

    // Rate unknown with ArrowLeft
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(500)

    // Should advance to next card (front) or complete
    const frontHint = page.locator('text=/Tap to flip|탭하여 뒤집기/i')
    const summary = page.locator('text=/Complete|완료/i')
    await expect(frontHint.or(summary).first()).toBeVisible({ timeout: 5000 })
  })
})
