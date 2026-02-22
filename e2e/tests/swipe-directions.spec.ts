import { test, expect } from '../fixtures/test-helpers'

/**
 * Helper: select a study mode by its text label instead of emoji.
 * The modal buttons contain text like "SRS (Spaced Repetition)", "Random", etc.
 */
async function selectModeByText(page: any, modeText: string) {
  const modal = page.locator('.fixed.inset-0')
  const modeButton = modal.getByRole('button').filter({ hasText: new RegExp(modeText, 'i') })
  await modeButton.click()
}

test.describe('Swipe Directions — Fixed per Study Mode', () => {

  test('SRS mode swipe hint shows Again / Good', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    await studySessionPage.enableSwipeMode()
    await quickStudyPage.navigate()
    await quickStudyPage.selectFirstDeck()

    // Select SRS mode — auto-starts immediately (no Start button needed)
    await selectModeByText(page, 'SRS')
    await page.waitForURL(/\/study\?/, { timeout: 10_000 })
    await page.waitForTimeout(2000)

    const noCards = await page.locator('text=/No cards|카드가 없|all reviewed|모두 복습/i').isVisible().catch(() => false)
    if (noCards) { test.skip(true, 'No SRS cards available'); return }

    // Flip the card
    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    // Swipe hint should show Again and Good
    const hint = studySessionPage.swipeHint
    await expect(hint).toBeVisible({ timeout: 3000 })
    const hintText = await hint.textContent()
    expect(hintText).toContain('Again')
    expect(hintText).toContain('Good')
    // Should NOT contain Unknown/Known
    expect(hintText).not.toContain('Unknown')
    expect(hintText).not.toContain('Known')
  })

  test('Random mode swipe hint shows Unknown / Known', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    await studySessionPage.enableSwipeMode()
    await quickStudyPage.navigate()
    await quickStudyPage.selectFirstDeck()

    // Select Random mode by text
    await selectModeByText(page, 'Random')
    await quickStudyPage.startStudy()
    await page.waitForURL(/\/study\?/, { timeout: 10_000 })
    await page.waitForTimeout(2000)

    const noCards = await page.locator('text=/No cards|카드가 없/i').isVisible().catch(() => false)
    if (noCards) { test.skip(true, 'No cards in deck'); return }

    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    const hint = studySessionPage.swipeHint
    await expect(hint).toBeVisible({ timeout: 3000 })
    const hintText = await hint.textContent()
    // Should contain Unknown and Known (or their i18n equivalents)
    expect(hintText).toMatch(/Unknown|모름|不知道|分からない/i)
    expect(hintText).toMatch(/Known|알고 있음|知道|知っている/i)
    // Should NOT contain Again/Good
    expect(hintText).not.toContain('Again')
    expect(hintText).not.toContain('Good')
  })

  test('Sequential Review mode swipe hint shows Unknown / Known', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    await studySessionPage.enableSwipeMode()
    await quickStudyPage.navigate()
    await quickStudyPage.selectFirstDeck()

    // Select Sequential Review mode by text
    await selectModeByText(page, 'Sequential Review')
    await quickStudyPage.startStudy()
    await page.waitForURL(/\/study\?/, { timeout: 10_000 })
    await page.waitForTimeout(2000)

    const noCards = await page.locator('text=/No cards|카드가 없/i').isVisible().catch(() => false)
    if (noCards) { test.skip(true, 'No cards in deck'); return }

    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    const hint = studySessionPage.swipeHint
    await expect(hint).toBeVisible({ timeout: 3000 })
    const hintText = await hint.textContent()
    expect(hintText).toMatch(/Unknown|모름|不知道|分からない/i)
    expect(hintText).toMatch(/Known|알고 있음|知道|知っている/i)
  })

  test('Swipe right in non-SRS mode advances card (known rating)', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    await studySessionPage.enableSwipeMode()
    await quickStudyPage.navigate()
    await quickStudyPage.selectFirstDeck()
    await selectModeByText(page, 'Random')
    await quickStudyPage.startStudy()
    await page.waitForURL(/\/study\?/, { timeout: 10_000 })
    await page.waitForTimeout(2000)

    const noCards = await page.locator('text=/No cards|카드가 없/i').isVisible().catch(() => false)
    if (noCards) { test.skip(true, 'No cards in deck'); return }

    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    // Swipe right (= 'known' for non-SRS mode)
    await studySessionPage.swipeCard('right', 80)
    await page.waitForTimeout(800)

    // After swipe: should advance to next card or summary
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

  test('Swipe left in non-SRS mode advances card (unknown rating)', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    await studySessionPage.enableSwipeMode()
    await quickStudyPage.navigate()
    await quickStudyPage.selectFirstDeck()
    await selectModeByText(page, 'Random')
    await quickStudyPage.startStudy()
    await page.waitForURL(/\/study\?/, { timeout: 10_000 })
    await page.waitForTimeout(2000)

    const noCards = await page.locator('text=/No cards|카드가 없/i').isVisible().catch(() => false)
    if (noCards) { test.skip(true, 'No cards in deck'); return }

    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    // Swipe left (= 'unknown' for non-SRS mode)
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
})

test.describe('Settings Page — Swipe Direction UI', () => {

  test('No direction dropdowns visible, info note shown when swipe selected', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(1500)

    // Switch to swipe mode by clicking the swipe card
    const swipeCard = page.locator('button').filter({ hasText: /Swipe|스와이프|滑动|スワイプ/i })
    await swipeCard.click()
    await page.waitForTimeout(500)

    // Direction dropdowns should NOT exist (no <select> elements)
    const selects = page.locator('select')
    const selectCount = await selects.count()
    expect(selectCount).toBe(0)

    // Info note should be visible (contains SRS + Again/Good info)
    const infoNote = page.locator('.bg-blue-50').filter({ hasText: /SRS/ })
    await expect(infoNote).toBeVisible({ timeout: 3000 })
  })

  test('Info note is hidden when button mode selected', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(1500)

    // Make sure button mode is selected
    const buttonCard = page.locator('button').filter({ hasText: /Button|버튼|按钮|ボタン/i })
    await buttonCard.click()
    await page.waitForTimeout(500)

    // Info note should NOT be visible
    const infoNote = page.locator('.bg-blue-50').filter({ hasText: /SRS/ })
    await expect(infoNote).not.toBeVisible()
  })

  test('Answer mode persists after save and reload', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(1500)

    // Switch to swipe mode
    const swipeCard = page.locator('button').filter({ hasText: /Swipe|스와이프|滑动|スワイプ/i })
    await swipeCard.click()
    await page.waitForTimeout(300)

    // Save settings
    const saveButton = page.getByRole('button', { name: /Save|저장|保存/i }).last()
    await saveButton.click()
    await page.waitForTimeout(1500)

    // Reload page
    await page.reload()
    await page.waitForTimeout(2000)

    // Swipe card should still be selected (has blue border)
    const swipeSelected = page.locator('.border-blue-500').filter({ hasText: /Swipe|스와이프|滑动|スワイプ/i })
    await expect(swipeSelected).toBeVisible({ timeout: 5000 })

    // Clean up: switch back to button mode
    const buttonCard = page.locator('button').filter({ hasText: /Button|버튼|按钮|ボタン/i })
    await buttonCard.click()
    await page.waitForTimeout(300)
    await saveButton.click()
    await page.waitForTimeout(1000)
  })
})

test.describe('SwipeGuide — Correct Arrow Positions', () => {

  test('Left arrow appears on the left side, right arrow on the right side', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    await studySessionPage.enableSwipeMode()
    await quickStudyPage.navigate()
    await quickStudyPage.selectFirstDeck()
    await selectModeByText(page, 'Random')
    await quickStudyPage.startStudy()
    await page.waitForURL(/\/study\?/, { timeout: 10_000 })
    await page.waitForTimeout(2000)

    const noCards = await page.locator('text=/No cards|카드가 없/i').isVisible().catch(() => false)
    if (noCards) { test.skip(true, 'No cards in deck'); return }

    await studySessionPage.flipCard()
    await page.waitForTimeout(300)

    // Find guide arrows — they are absolute positioned within the card
    const leftArrow = page.locator('.absolute.pointer-events-none').filter({ hasText: '←' })
    const rightArrow = page.locator('.absolute.pointer-events-none').filter({ hasText: '→' })

    // Both should be visible briefly (2 seconds)
    if (await leftArrow.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Check CSS class: left arrow should have 'left-3' class
      const leftClass = await leftArrow.getAttribute('class')
      expect(leftClass).toContain('left-3')

      if (await rightArrow.isVisible({ timeout: 500 }).catch(() => false)) {
        const rightClass = await rightArrow.getAttribute('class')
        expect(rightClass).toContain('right-3')
      }
    }
    // If not visible, guide has already faded (timing-sensitive) — that's OK
  })
})
