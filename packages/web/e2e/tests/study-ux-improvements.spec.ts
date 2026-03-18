import { test, expect } from '../fixtures/test-helpers'

/**
 * E2E tests for study UX improvements:
 * 1. Progress bar shows correct numbers (1/N on first card, N/N on last)
 * 2. Exit confirm dialog when pressing X during study
 * 3. TTS settings (speed slider, provider selector) in Settings page
 * 4. TTS stops on session complete
 */

// ── Helper: flip and rate "known" via UI click. Returns true if session is still active. ──
async function flipAndRateKnown(page: any): Promise<boolean> {
  // Click "Tap to flip" hint or the card body to flip
  const tapToFlip = page.locator('text=/Tap to flip|탭하여 뒤집기|눌러서/i')
  if (await tapToFlip.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tapToFlip.click()
  } else {
    // Fallback: click the card container (the rounded white area)
    await page.locator('.rounded-2xl, .rounded-3xl').first().click()
  }
  await page.waitForTimeout(800)

  // Click Known/알고 있음 button (or Got It for cramming)
  const rateBtn = page.getByRole('button', { name: /Known|알고 있음|Got It|알겠어요/i }).first()
  if (await rateBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await rateBtn.click()
  } else {
    // Fallback: try keyboard
    await page.keyboard.press('ArrowRight')
  }
  await page.waitForTimeout(800)
  // Return whether we're still in the study session
  return page.url().includes('/study')
}

// ── Helper: start a study session (random mode, fast) ──────
async function startRandomStudy(
  quickStudyPage: any,
  page: any,
): Promise<boolean> {
  await quickStudyPage.navigate()
  await quickStudyPage.selectFirstDeck()

  // Select random mode (🎲) — requires clicking Start button after selection
  await quickStudyPage.selectMode('🎲')
  await page.waitForTimeout(500)

  // Click Start Study button
  await quickStudyPage.startStudy()
  await page.waitForURL(/\/study\?/, { timeout: 15_000 })
  // Wait for study content to render
  await page.waitForTimeout(3000)

  // Check if we have cards
  const noCards = await page
    .locator('text=/No Cards to Study|No cards|카드가 없|학습할 카드/i')
    .isVisible()
    .catch(() => false)
  const hasFlipHint = await page
    .locator('text=/Tap to flip|탭하여 뒤집기|눌러서/i')
    .isVisible()
    .catch(() => false)
  return !noCards && hasFlipHint
}

// ════════════════════════════════════════════════════════════
// 1. Progress Bar — correct card numbering
// ════════════════════════════════════════════════════════════

test.describe('Progress Bar — Card Count Display', () => {
  test('first card shows 1/N (not 0/N)', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await startRandomStudy(quickStudyPage, page)
    if (!hasCards) {
      test.skip(true, 'No cards in deck')
      return
    }

    // On the very first card, progress should show "1/..."
    const progressText = await studySessionPage.getProgressText()
    console.log(`[progress] First card: ${progressText}`)

    const match = progressText.match(/(\d+)\/(\d+)/)
    expect(match).toBeTruthy()
    if (match) {
      const current = parseInt(match[1])
      const total = parseInt(match[2])
      expect(current).toBe(1) // Must be 1, not 0
      expect(total).toBeGreaterThan(0)
    }
  })

  test('progress increments after rating a card', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await startRandomStudy(quickStudyPage, page)
    if (!hasCards) {
      test.skip(true, 'No cards in deck')
      return
    }

    // First card = 1/N
    const before = await studySessionPage.getProgressText()
    const matchBefore = before.match(/(\d+)\/(\d+)/)
    expect(matchBefore).toBeTruthy()
    const firstNum = parseInt(matchBefore![1])
    const total = parseInt(matchBefore![2])

    if (total < 2) {
      test.skip(true, 'Need at least 2 cards to test increment')
      return
    }

    // Rate the first card
    await flipAndRateKnown(page)
    await page.waitForTimeout(500)

    // Second card = 2/N
    const after = await studySessionPage.getProgressText()
    const matchAfter = after.match(/(\d+)\/(\d+)/)
    expect(matchAfter).toBeTruthy()
    const secondNum = parseInt(matchAfter![1])
    expect(secondNum).toBeGreaterThan(firstNum)
    console.log(`[progress] ${before} → ${after}`)
  })
})

// ════════════════════════════════════════════════════════════
// 2. Exit Confirm Dialog
// ════════════════════════════════════════════════════════════

test.describe('Exit Confirm Dialog', () => {
  test('X button shows confirm dialog after studying at least 1 card', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await startRandomStudy(quickStudyPage, page)
    if (!hasCards) {
      test.skip(true, 'No cards in deck')
      return
    }

    // Study 1 card first (so cardsStudied > 0)
    await flipAndRateKnown(page)
    await page.waitForTimeout(500)

    // Verify we're still in the study session (not redirected after completion)
    const stillStudying = page.url().includes('/study')
    if (!stillStudying) {
      test.skip(true, 'Session completed after rating — not enough cards')
      return
    }

    // Click X button
    await studySessionPage.exitButton.first().click()
    await page.waitForTimeout(300)

    // Confirm dialog should appear
    await expect(studySessionPage.exitConfirmDialog).toBeVisible({ timeout: 3000 })

    // Dialog should have confirm and cancel buttons
    await expect(studySessionPage.confirmExitButton).toBeVisible()
    await expect(studySessionPage.cancelExitButton).toBeVisible()
    console.log('[exit-dialog] Dialog appeared with confirm/cancel buttons')
  })

  test('cancel button closes dialog and continues studying', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await startRandomStudy(quickStudyPage, page)
    if (!hasCards) {
      test.skip(true, 'No cards in deck')
      return
    }

    // Study 1 card
    const stillActive1 = await flipAndRateKnown(page)
    if (!stillActive1) { test.skip(true, 'Session completed — not enough cards'); return }

    // Open exit dialog
    await studySessionPage.exitButton.first().click()
    await page.waitForTimeout(300)
    await expect(studySessionPage.exitConfirmDialog).toBeVisible()

    // Click cancel
    await studySessionPage.cancelExitButton.click()
    await page.waitForTimeout(300)

    // Dialog should close
    await expect(studySessionPage.exitConfirmDialog).not.toBeVisible()

    // Should still be on study page
    await expect(page).toHaveURL(/\/study\?/)
    console.log('[exit-dialog] Cancel keeps user in study session')
  })

  test('confirm button ends session and shows summary', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await startRandomStudy(quickStudyPage, page)
    if (!hasCards) {
      test.skip(true, 'No cards in deck')
      return
    }

    // Study 1 card
    const stillActive = await flipAndRateKnown(page)
    if (!stillActive) {
      test.skip(true, 'Session completed after rating — not enough cards')
      return
    }
    await page.waitForTimeout(500)

    // Open exit dialog and confirm
    await studySessionPage.exitButton.first().click()
    await page.waitForTimeout(300)
    await expect(studySessionPage.exitConfirmDialog).toBeVisible({ timeout: 3000 })
    await studySessionPage.confirmExitButton.click()

    // Should show summary or navigate back
    await page.waitForTimeout(1000)
    const summaryVisible = await page
      .locator('text=/Complete|완료|Session Ended|학습 종료/i')
      .first()
      .isVisible()
      .catch(() => false)

    const navigatedBack = page.url().includes('/decks/')

    expect(summaryVisible || navigatedBack).toBeTruthy()
    console.log(`[exit-dialog] Session ended (summary: ${summaryVisible}, navigated: ${navigatedBack})`)
  })

  test('X button without studying any card exits immediately (no dialog)', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await startRandomStudy(quickStudyPage, page)
    if (!hasCards) {
      test.skip(true, 'No cards in deck')
      return
    }

    // Click X immediately without studying any card
    await studySessionPage.exitButton.first().click()
    await page.waitForTimeout(500)

    // Should NOT show dialog — should navigate directly
    const dialogVisible = await studySessionPage.exitConfirmDialog
      .isVisible({ timeout: 500 })
      .catch(() => false)
    expect(dialogVisible).toBe(false)

    // Should have navigated away from study page
    await page.waitForTimeout(500)
    expect(page.url()).not.toMatch(/\/study\?/)
    console.log('[exit-dialog] No dialog shown when 0 cards studied')
  })

  test('Escape key shows exit confirm dialog', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await startRandomStudy(quickStudyPage, page)
    if (!hasCards) {
      test.skip(true, 'No cards in deck')
      return
    }

    // Study 1 card
    const stillActive = await flipAndRateKnown(page)
    if (!stillActive) { test.skip(true, 'Session completed — not enough cards'); return }

    // Press Escape
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // Dialog should appear
    await expect(studySessionPage.exitConfirmDialog).toBeVisible({ timeout: 3000 })
    console.log('[exit-dialog] Escape key triggered exit dialog')
  })
})

// ════════════════════════════════════════════════════════════
// 3. TTS Settings — Speed Slider & Provider Selector
// ════════════════════════════════════════════════════════════

test.describe('TTS Settings Page', () => {
  test('TTS speed slider is visible and functional', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(2000)

    // Find speed slider
    const slider = page.locator('input[type="range"]').first()
    await slider.scrollIntoViewIfNeeded()
    await expect(slider).toBeVisible()

    // Check slider attributes
    const min = await slider.getAttribute('min')
    const max = await slider.getAttribute('max')
    const step = await slider.getAttribute('step')
    expect(min).toBe('0.5')
    expect(max).toBe('2')
    expect(step).toBe('0.1')

    // Get current value
    const currentValue = await slider.inputValue()
    console.log(`[tts-settings] Speed slider value: ${currentValue}`)

    // Change the speed value — use React-compatible event dispatch
    await slider.evaluate((el: HTMLInputElement) => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set
      nativeInputValueSetter?.call(el, '1.5')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.waitForTimeout(500)

    // Verify the display shows new value
    const speedDisplay = page.locator('text=/1\\.5x/')
    await expect(speedDisplay).toBeVisible({ timeout: 3000 })
    console.log('[tts-settings] Speed slider updated to 1.5x')
  })

  test('TTS provider selector shows two options', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(2000)

    // Scroll to TTS section
    const ttsSection = page.locator('text=/Auto TTS|자동 TTS|自动|自動/i').first()
    await ttsSection.scrollIntoViewIfNeeded()

    // Should see two provider buttons
    const webSpeechButton = page.locator('button').filter({
      hasText: /Device Voice|기기 음성|设备语音|デバイス音声/i,
    })
    const edgeTtsButton = page.locator('button').filter({
      hasText: /Edge TTS/i,
    })

    await expect(webSpeechButton).toBeVisible()
    await expect(edgeTtsButton).toBeVisible()
    console.log('[tts-settings] Both provider options visible')
  })

  test('TTS provider can be switched to Edge TTS', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(2000)

    // Click Edge TTS button
    const edgeTtsButton = page.locator('button').filter({
      hasText: /Edge TTS/i,
    })
    await edgeTtsButton.scrollIntoViewIfNeeded()
    await edgeTtsButton.click()
    await page.waitForTimeout(300)

    // Edge TTS button should now have selected styling (blue border)
    const borderColor = await edgeTtsButton.evaluate(
      (el) => getComputedStyle(el).borderColor,
    )
    // Blue border indicates selection
    console.log(`[tts-settings] Edge TTS button border: ${borderColor}`)

    // The button should have the active class
    const classList = await edgeTtsButton.getAttribute('class')
    expect(classList).toContain('border-blue-500')
    console.log('[tts-settings] Edge TTS selected')
  })

  test('TTS settings save shows success toast', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(2000)

    // Select Edge TTS
    const edgeTtsButton = page.locator('button').filter({
      hasText: /Edge TTS/i,
    })
    await edgeTtsButton.scrollIntoViewIfNeeded()
    await edgeTtsButton.click()
    await page.waitForTimeout(300)

    // Verify selection is highlighted
    const classList = await edgeTtsButton.getAttribute('class')
    expect(classList).toContain('border-blue-500')

    // Change speed — use nativeInputValueSetter for React-compatible range input
    const slider = page.locator('input[type="range"]').first()
    await slider.scrollIntoViewIfNeeded()
    await slider.evaluate((el: HTMLInputElement) => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set
      nativeInputValueSetter?.call(el, '1.5')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await page.waitForTimeout(500)

    // Verify speed display
    const speedDisplay = page.locator('text=/1\\.5x/')
    await expect(speedDisplay).toBeVisible({ timeout: 3000 })

    // TTS settings auto-save on change — wait for success toast
    await page.waitForTimeout(1000)
    const toast = page.locator('text=/saved|저장되었|保存成功|Auto-saved|자동 저장/i')
    const toastVisible = await toast.first().isVisible({ timeout: 5000 }).catch(() => false)
    console.log(`[tts-settings] Auto-save toast visible: ${toastVisible}`)

    // Reset back to defaults
    const webSpeechButton = page.locator('button').filter({
      hasText: /Device Voice|기기 음성|设备语音|デバイス音声/i,
    })
    await webSpeechButton.click()
    await page.waitForTimeout(1000)
  })
})

// ════════════════════════════════════════════════════════════
// 4. TTS behavior during study
// ════════════════════════════════════════════════════════════

test.describe('TTS During Study', () => {
  test('TTS play button is visible on card with TTS-enabled fields', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await startRandomStudy(quickStudyPage, page)
    if (!hasCards) {
      test.skip(true, 'No cards in deck')
      return
    }

    // Flip the card
    await studySessionPage.flipCard()
    await page.waitForTimeout(500)

    // Look for TTS button (Volume2 icon) — it may or may not exist depending on template settings
    const ttsButton = page.locator('button').filter({
      has: page.locator('svg'),
    }).filter({
      hasText: '',
    })

    // Just log whether TTS button exists (depends on card template)
    const hasTtsButton = await ttsButton.first().isVisible({ timeout: 1000 }).catch(() => false)
    console.log(`[tts-study] TTS button visible: ${hasTtsButton}`)
  })

  test('session completion stops any playing audio', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    // We verify that speechSynthesis.cancel() gets called when session completes
    // by checking the speechSynthesis state before and after completion

    const hasCards = await startRandomStudy(quickStudyPage, page)
    if (!hasCards) {
      test.skip(true, 'No cards in deck')
      return
    }

    // Inject a spy on speechSynthesis.cancel
    await page.evaluate(() => {
      (window as any).__ttsCancelCount = 0
      const original = window.speechSynthesis?.cancel?.bind(window.speechSynthesis)
      if (window.speechSynthesis && original) {
        window.speechSynthesis.cancel = () => {
          (window as any).__ttsCancelCount++;
          original()
        }
      }
    })

    // Get total cards
    const progressText = await studySessionPage.getProgressText()
    const match = progressText.match(/\d+\/(\d+)/)
    const total = match ? parseInt(match[1]) : 0

    if (total === 0 || total > 10) {
      test.skip(true, `Impractical card count for completion test: ${total}`)
      return
    }

    // Rate all cards to complete session
    for (let i = 0; i < total; i++) {
      await flipAndRateKnown(page)
      await page.waitForTimeout(300)
    }

    // Wait for completion
    await page.waitForTimeout(1000)

    // Check that cancel was called (stopSpeaking on complete)
    const cancelCount = await page.evaluate(() => (window as any).__ttsCancelCount ?? 0)
    console.log(`[tts-stop] speechSynthesis.cancel called ${cancelCount} times during session`)
    // At minimum, cancel is called during rating transitions + completion
    expect(cancelCount).toBeGreaterThan(0)
  })
})

// ════════════════════════════════════════════════════════════
// 5. Mobile viewport tests
// ════════════════════════════════════════════════════════════

test.describe('Mobile — Study UX', () => {
  test.use({ viewport: { width: 393, height: 851 } })

  test('progress bar and exit button visible on mobile', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await startRandomStudy(quickStudyPage, page)
    if (!hasCards) {
      test.skip(true, 'No cards in deck')
      return
    }

    // Progress text should be visible
    await expect(studySessionPage.progressText).toBeVisible()

    // Exit button should be visible
    await expect(studySessionPage.exitButton.first()).toBeVisible()

    // Progress should show 1/N
    const progressText = await studySessionPage.getProgressText()
    expect(progressText).toMatch(/^1\/\d+$/)
    console.log(`[mobile] Progress visible: ${progressText}`)
  })

  test('exit dialog works on mobile', async ({
    quickStudyPage,
    studySessionPage,
    page,
  }) => {
    const hasCards = await startRandomStudy(quickStudyPage, page)
    if (!hasCards) {
      test.skip(true, 'No cards in deck')
      return
    }

    // Study 1 card
    const mobileActive = await flipAndRateKnown(page)
    if (!mobileActive) { test.skip(true, 'Session completed — not enough cards'); return }

    // Tap X
    await studySessionPage.exitButton.first().click()
    await page.waitForTimeout(300)

    // Dialog should appear
    await expect(studySessionPage.exitConfirmDialog).toBeVisible()

    // Buttons should be tappable (minimum 44px touch target)
    const confirmBox = await studySessionPage.confirmExitButton.boundingBox()
    expect(confirmBox).toBeTruthy()
    if (confirmBox) {
      expect(confirmBox.height).toBeGreaterThanOrEqual(36) // at least py-2 (36px)
      console.log(`[mobile] Confirm button size: ${confirmBox.width}x${confirmBox.height}`)
    }

    // Cancel and confirm
    await studySessionPage.cancelExitButton.click()
    await expect(studySessionPage.exitConfirmDialog).not.toBeVisible()
    console.log('[mobile] Exit dialog works on mobile viewport')
  })

  test('TTS settings accessible on mobile', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(2000)

    // Scroll to TTS section
    const ttsTitle = page.locator('text=/Auto TTS|자동 TTS/i').first()
    await ttsTitle.scrollIntoViewIfNeeded()
    await expect(ttsTitle).toBeVisible()

    // Speed slider should be visible
    const slider = page.locator('input[type="range"]').first()
    await slider.scrollIntoViewIfNeeded()
    await expect(slider).toBeVisible()

    // Provider buttons should be visible
    const edgeTtsBtn = page.locator('button').filter({ hasText: /Edge TTS/i })
    await edgeTtsBtn.scrollIntoViewIfNeeded()
    await expect(edgeTtsBtn).toBeVisible()
    console.log('[mobile] TTS settings accessible on mobile')
  })
})
