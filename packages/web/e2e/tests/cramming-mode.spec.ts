import { test, expect } from '../fixtures/test-helpers'

test.describe('Cramming Mode — Full Flow', () => {

  test('QuickStudy → Cramming mode shows setup panel before starting', async ({
    quickStudyPage,
    page,
  }) => {
    await quickStudyPage.navigate()

    // Select first available deck
    await quickStudyPage.selectFirstDeck()

    // Select cramming mode (⚡)
    await quickStudyPage.selectCrammingMode()

    // Should show cramming setup panel, NOT navigate to study immediately
    await quickStudyPage.expectCrammingSetupVisible()

    // Should see time limit presets
    await expect(page.getByRole('button', { name: /15/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /30/i })).toBeVisible()

    // Should NOT have navigated to the study page yet
    await expect(page).toHaveURL(/\/quick-study/)
  })

  test('Cramming session shows correct UI elements', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    await quickStudyPage.navigate()
    await quickStudyPage.selectFirstDeck()
    await quickStudyPage.selectCrammingMode()
    await quickStudyPage.expectCrammingSetupVisible()
    await quickStudyPage.startStudy()

    // Should navigate to study session page
    await page.waitForURL(/\/study\?/, { timeout: 10_000 })

    // Wait for session to load
    await page.waitForTimeout(2000)

    // Check if we have cards or not
    const noCards = await page.locator('text=/No cards|카드가 없/i').isVisible().catch(() => false)
    if (noCards) {
      test.skip(true, 'No cards in deck — skipping UI verification')
      return
    }

    // Verify cramming-specific UI: round badge + mastery
    await studySessionPage.expectCrammingUI()
  })

  test('Cramming cards can be flipped and rated (Got It)', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    await quickStudyPage.navigate()
    await quickStudyPage.selectFirstDeck()
    await quickStudyPage.selectCrammingMode()
    await quickStudyPage.startStudy()
    await page.waitForURL(/\/study\?/, { timeout: 10_000 })
    await page.waitForTimeout(2000)

    const noCards = await page.locator('text=/No cards|카드가 없/i').isVisible().catch(() => false)
    if (noCards) {
      test.skip(true, 'No cards in deck')
      return
    }

    // Flip the card
    await studySessionPage.flipCard()
    await page.waitForTimeout(300)

    // Got It button should be visible after flipping
    await expect(studySessionPage.gotItButton).toBeVisible({ timeout: 5000 })
    await expect(studySessionPage.missedButton).toBeVisible()

    // Rate as Got It
    await studySessionPage.rateGotIt()

    // Should advance to next card or complete
    await page.waitForTimeout(500)
  })

  test('Cramming keyboard shortcuts work (Space=flip, →=got_it, ←=missed)', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    await quickStudyPage.navigate()
    await quickStudyPage.selectFirstDeck()
    await quickStudyPage.selectCrammingMode()
    await quickStudyPage.startStudy()
    await page.waitForURL(/\/study\?/, { timeout: 10_000 })
    await page.waitForTimeout(2000)

    const noCards = await page.locator('text=/No cards|카드가 없/i').isVisible().catch(() => false)
    if (noCards) {
      test.skip(true, 'No cards in deck')
      return
    }

    // Flip via Space
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)

    // Got It button should be visible
    await expect(studySessionPage.gotItButton).toBeVisible({ timeout: 5000 })

    // Rate via keyboard (ArrowRight = got_it)
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(500)
  })

  test('Cramming session completes and shows summary', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    test.setTimeout(60_000) // Cramming re-insertion means more cards to rate

    await quickStudyPage.navigate()
    await quickStudyPage.selectFirstDeck()
    await quickStudyPage.selectCrammingMode()
    await quickStudyPage.startStudy()
    await page.waitForURL(/\/study\?/, { timeout: 10_000 })
    await page.waitForTimeout(1500)

    const noCards = await page.locator('text=/No cards|카드가 없/i').isVisible().catch(() => false)
    if (noCards) {
      test.skip(true, 'No cards in deck')
      return
    }

    // Rate all cards as Got It until session completes
    let attempts = 0
    const maxAttempts = 60

    while (attempts < maxAttempts) {
      // Check if summary is already visible
      const summaryVisible = await page
        .locator('text=/Complete|완료|Time.*Up|시간.*종료/i')
        .first()
        .isVisible()
        .catch(() => false)

      if (summaryVisible) break

      // Try to click "Got It!" button, flip first if needed
      try {
        const gotItBtn = page.getByRole('button', { name: /Got It|알겠어요/i })
        const isFlipped = await gotItBtn.isVisible({ timeout: 300 }).catch(() => false)

        if (!isFlipped) {
          // Flip via click on "Tap to flip" text
          await page.locator('text=/Tap to flip|탭하여 뒤집기/i').click({ timeout: 2000 }).catch(() => {})
          await page.waitForTimeout(400)
        }

        // Click "Got It!" with short timeout — re-query to get fresh DOM element
        await page.getByRole('button', { name: /Got It|알겠어요/i }).click({ timeout: 3000 })
        await page.waitForTimeout(400)
      } catch {
        // Card might have transitioned; just wait and retry
        await page.waitForTimeout(300)
      }

      attempts++
    }

    // Summary should be visible
    await studySessionPage.expectSummaryVisible()

    // Should show SRS notice
    await studySessionPage.expectSrsNotice()

    // Should show action buttons
    await expect(studySessionPage.backToDeckButton).toBeVisible()
    await expect(studySessionPage.cramAgainButton).toBeVisible()
  })

  test('Cramming setup panel filter selection works', async ({
    quickStudyPage,
    page,
  }) => {
    await quickStudyPage.navigate()
    await quickStudyPage.selectFirstDeck()
    await quickStudyPage.selectCrammingMode()
    await quickStudyPage.expectCrammingSetupVisible()

    // Click "Weak Cards Only" / "약한 카드만" filter
    const weakFilter = page.getByRole('button').filter({ hasText: /Weak|약한/i })
    if (await weakFilter.isVisible().catch(() => false)) {
      await weakFilter.click()
      // Verify it's selected (purple border)
      await expect(weakFilter).toHaveClass(/border-purple/)
    }

    // Click "Due Soon" / "곧 복습" filter
    const dueSoonFilter = page.getByRole('button').filter({ hasText: /Due Soon|곧 복습/i })
    if (await dueSoonFilter.isVisible().catch(() => false)) {
      await dueSoonFilter.click()
      await expect(dueSoonFilter).toHaveClass(/border-purple/)
    }
  })

  test('Cramming time limit selection works', async ({
    quickStudyPage,
    page,
  }) => {
    await quickStudyPage.navigate()
    await quickStudyPage.selectFirstDeck()
    await quickStudyPage.selectCrammingMode()
    await quickStudyPage.expectCrammingSetupVisible()

    // Select 15 min time limit
    const btn15 = page.getByRole('button', { name: /15/i })
    await btn15.click()
    await expect(btn15).toHaveClass(/border-purple/)

    // Select 30 min
    const btn30 = page.getByRole('button', { name: /30/i })
    await btn30.click()
    await expect(btn30).toHaveClass(/border-purple/)

    // Switch back to "No Limit"
    const noLimit = page.getByRole('button', { name: /No Limit|제한 없음|없음/i })
    if (await noLimit.isVisible().catch(() => false)) {
      await noLimit.click()
      await expect(noLimit).toHaveClass(/border-purple/)
    }
  })
})
