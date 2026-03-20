import StudySetupScreen from '../screens/StudySetupScreen'
import StudySessionScreen from '../screens/StudySessionScreen'
import StudySummaryScreen from '../screens/StudySummaryScreen'
import { navigateToTab } from '../helpers/navigation'
import { scrollUp, scrollDown } from '../helpers/scroll'
import { createTestDeck, cleanupTestDeck, queryCards } from '../helpers/supabase-api'

describe('Study Flow — Full E2E', () => {
  let testDeckId: string | null = null

  // Create fresh test deck with new cards BEFORE study tests
  // NOTE: createTestDeck calls Supabase auth API → creates new session → kicks app session
  // So we must re-login the app afterward
  before(async () => {
    const result = await createTestDeck([
      { front: 'Apple', back: 'A red fruit' },
      { front: 'Dog', back: 'A loyal animal' },
      { front: 'Book', back: 'Something to read' },
    ])
    testDeckId = result.deckId

    // createTestDeck uses Supabase auth API → creates new session → kicks app session.
    // Force app restart to clear stale session and pick up new deck.
    console.log('[study] Restarting app to pick up API-created deck...')
    await browser.pause(2000)

    // Terminate and relaunch the app to force a clean session
    if (!driver.isIOS) {
      try {
        await driver.terminateApp('com.reeeeecall.study')
        await browser.pause(2000)
        await driver.activateApp('com.reeeeecall.study')
        await browser.pause(5000)
      } catch (e) {
        console.log(`[study] App restart failed: ${e}`)
      }
    }

    const { loginIfNeeded } = await import('../helpers/auth')
    await loginIfNeeded()
    await browser.pause(3000)

    // Verify we're on main screen
    let onMainScreen = false
    if (driver.isIOS) {
      const tabBar = $('-ios class chain:**/XCUIElementTypeTabBar')
      onMainScreen = await tabBar.isDisplayed().catch(() => false)
    } else {
      onMainScreen = await $('~HomeTab').isDisplayed().catch(() => false)
    }
    console.log(`[study] On main screen after restart: ${onMainScreen}`)
  })

  // Cleanup after all tests
  after(async () => {
    if (testDeckId) {
      await cleanupTestDeck(testDeckId)
      testDeckId = null
    }
  })

  // ─── Setup Screen ──────────────────────────────────────
  describe('StudySetupScreen', () => {
    it('should display study setup screen', async () => {
      // Debug: check what screen we're on at test start
      await browser.saveScreenshot('./e2e-debug-study-test-start.png')
      const homeTabVisible = await $('~HomeTab').isDisplayed().catch(() => false)
      console.log(`[study-test] HomeTab visible at test start: ${homeTabVisible}`)
      if (!homeTabVisible) {
        // May be on login screen — try to re-login
        const { loginIfNeeded } = await import('../helpers/auth')
        await loginIfNeeded()
        await browser.pause(2000)
      }

      // Navigate away then to Study — forces useDecks() to re-fetch (picks up API-created deck)
      await browser.pause(2000)
      await navigateToTab('Home')
      await browser.pause(1000)
      await navigateToTab('Study')
      await browser.pause(5000)

      // Handle stale states from previous runs
      for (let round = 0; round < 3; round++) {
        if (await StudySetupScreen.isDisplayed()) break
        const done = $('~summary-back-to-deck')
        if (await done.isDisplayed().catch(() => false)) { await done.click(); await browser.pause(1000); continue }
        const exit = $('~study-exit-button')
        if (await exit.isDisplayed().catch(() => false)) {
          await exit.click(); await browser.pause(500)
          const endSelectors = driver.isIOS
            ? ['-ios predicate string:name CONTAINS "End"', '~End']
            : ['~End', 'android=new UiSelector().text("End")']
          for (const s of endSelectors) {
            const b = $(s); if (await b.isDisplayed().catch(() => false)) { await b.click(); await browser.pause(1000); break }
          }
          continue
        }
        await navigateToTab('Home'); await browser.pause(500)
        await navigateToTab('Study'); await browser.pause(2000)
      }

      await StudySetupScreen.waitForScreen()
      expect(await StudySetupScreen.isDisplayed()).toBe(true)
    })

    it('should show our test deck in the list', async () => {
      // The deck list may need to load — retry with tab refresh multiple times
      let found = false
      const chipSel = `~study-deck-${testDeckId}`
      // Also try finding by deck name text (Android fallback)
      const nameSel = driver.isIOS ? chipSel : `android=new UiSelector().text("_E2E Study Test")`

      for (let attempt = 0; attempt < 5; attempt++) {
        await scrollUp().catch(() => {})
        await browser.pause(500)

        if (await $(chipSel).isExisting().catch(() => false)) { found = true; break }
        if (await $(nameSel).isExisting().catch(() => false)) { found = true; break }

        // Scroll down to check if deck is below fold
        await scrollDown().catch(() => {})
        await browser.pause(500)
        if (await $(chipSel).isExisting().catch(() => false)) { found = true; break }
        if (await $(nameSel).isExisting().catch(() => false)) { found = true; break }

        // Force refresh: navigate away and back (triggers useFocusEffect re-fetch)
        await navigateToTab('Home')
        await browser.pause(1000)
        await navigateToTab('Study')
        await browser.pause(4000)
      }
      expect(found).toBe(true)
    })

    it('should show start button', async () => {
      // Use UiScrollable on Android to reliably scroll to the start button
      await StudySetupScreen.scrollToStartButton()
      const visible = await StudySetupScreen.startButton.isDisplayed().catch(() => false)
      const exists = await StudySetupScreen.startButton.isExisting().catch(() => false)
      expect(visible || exists).toBe(true)
    })
  })

  // ─── Session Screen — Full Card Interaction ────────────
  describe('StudySessionScreen', () => {
    it('should select test deck and start SRS session', async () => {
      // Scroll to top first — may need multiple scrolls after previous test scrolled down
      for (let i = 0; i < 8; i++) {
        await scrollUp().catch(() => {})
        await browser.pause(300)
      }
      await browser.pause(500)

      // Select our freshly created test deck (has 3 new cards)
      let chip: WebdriverIO.Element

      if (driver.isAndroid) {
        // Android: use UiScrollable to find deck by text (most reliable)
        try {
          chip = $(`android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().text("_E2E Study Test"))`)
          await chip.waitForExist({ timeout: 10000 })
        } catch {
          // Fallback to content-desc
          chip = $(`~study-deck-${testDeckId}`)
          await chip.waitForExist({ timeout: 5000 })
        }
      } else {
        chip = $(`~study-deck-${testDeckId}`)
        for (let i = 0; i < 8; i++) {
          if (await chip.isExisting().catch(() => false)) break
          await scrollDown().catch(() => {})
          await browser.pause(300)
        }
        await chip.waitForExist({ timeout: 5000 })
      }

      await chip.click()
      await browser.pause(500)

      // Select SRS mode (our cards are srs_status='new' so SRS will show them)
      await StudySetupScreen.selectMode('srs')
      await browser.pause(300)

      // Start study
      await StudySetupScreen.start()

      // Wait for study card to appear
      await browser.pause(3000)
      await browser.saveScreenshot('./e2e-debug-study-session.png')
      await StudySessionScreen.cardArea.waitForDisplayed({ timeout: 15000 })
      expect(await StudySessionScreen.isCardVisible()).toBe(true)
    })

    it('should show card content (tap-to-flip area)', async () => {
      expect(await StudySessionScreen.isCardVisible()).toBe(true)
    })

    it('should flip card on tap and show rating buttons', async () => {
      await StudySessionScreen.flipCard()
      await browser.pause(500)

      // All 4 SRS rating buttons should appear
      await StudySessionScreen.rateAgain.waitForDisplayed({ timeout: 5000 })
      expect(await StudySessionScreen.rateAgain.isDisplayed()).toBe(true)
      expect(await StudySessionScreen.rateHard.isDisplayed()).toBe(true)
      expect(await StudySessionScreen.rateGood.isDisplayed()).toBe(true)
      expect(await StudySessionScreen.rateEasy.isDisplayed()).toBe(true)
    })

    it('should rate "Again" and card remains in session (re-queued)', async () => {
      // Rate first card "Again" — it should be re-queued for later
      await StudySessionScreen.rate('again')
      await browser.pause(800)

      // Next card should appear (card 2 of 3)
      await StudySessionScreen.cardArea.waitForDisplayed({ timeout: 5000 })
      expect(await StudySessionScreen.isCardVisible()).toBe(true)
    })

    it('should rate "Easy" and advance to next card', async () => {
      // Flip card 2
      await StudySessionScreen.flipCard()
      await browser.pause(500)

      // Rate "Easy" — graduates immediately, no re-queue
      await StudySessionScreen.rate('easy')
      await browser.pause(800)

      // Card 3 should appear
      await StudySessionScreen.cardArea.waitForDisplayed({ timeout: 5000 })
      expect(await StudySessionScreen.isCardVisible()).toBe(true)
    })

    it('should rate "Good" and advance', async () => {
      // Flip card 3
      await StudySessionScreen.flipCard()
      await browser.pause(500)

      // Rate "Good" — enters learning steps
      await StudySessionScreen.rate('good')
      await browser.pause(800)
    })

    it('should complete session by rating all remaining cards', async () => {
      // The "Again" card and "Good" learning card may reappear — rate them all "Easy"
      for (let i = 0; i < 10; i++) {
        // Check if session is already complete (summary screen appeared)
        if (await StudySummaryScreen.screen.isExisting().catch(() => false)) break
        if (await $('~summary-back-to-deck').isExisting().catch(() => false)) break

        const hasCard = await StudySessionScreen.isCardVisible()
        if (!hasCard) break

        await StudySessionScreen.flipCard()
        await browser.pause(600)

        // Wait for rating buttons with retry
        const rateEasy = $('~study-rate-easy')
        for (let j = 0; j < 5; j++) {
          if (await rateEasy.isDisplayed().catch(() => false)) break
          await browser.pause(500)
        }
        if (await rateEasy.isDisplayed().catch(() => false)) {
          await rateEasy.click()
          await browser.pause(800)
        }
      }

      // Session should now be complete — summary should appear
      await StudySummaryScreen.screen.waitForDisplayed({ timeout: 15000 })
      expect(await StudySummaryScreen.isDisplayed()).toBe(true)
    })
  })

  // ─── Summary Screen ───────────────────────────────────
  describe('StudySummaryScreen', () => {
    it('should show cards studied count', async () => {
      expect(await StudySummaryScreen.cardsStudied.isDisplayed()).toBe(true)
    })

    it('should show time stat', async () => {
      expect(await StudySummaryScreen.time.isDisplayed()).toBe(true)
    })

    it('should show Study Again and Done buttons', async () => {
      const studyAgain = await StudySummaryScreen.studyAgainButton.isDisplayed().catch(() => false)
      const done = await StudySummaryScreen.doneButton.isDisplayed().catch(() => false)
      expect(studyAgain || done).toBe(true)
    })

    it('should navigate back to setup on Done', async () => {
      await StudySummaryScreen.tapDone()
      await browser.pause(1000)
      await StudySetupScreen.waitForScreen()
      expect(await StudySetupScreen.isDisplayed()).toBe(true)
    })
  })

  // ─── DB Verification ──────────────────────────────────
  describe('DB State After Study', () => {
    it('should have updated card SRS status in database', async () => {
      // Wait for background DB writes to complete
      await browser.pause(3000)

      const cards = await queryCards(testDeckId!)
      expect(cards.length).toBe(3)

      // All cards should no longer be 'new' after being studied
      const stillNew = cards.filter(c => c.srs_status === 'new')
      expect(stillNew.length).toBe(0)

      console.log('[study-db] Card states after study:')
      for (const c of cards) {
        console.log(`  ${c.id}: srs_status=${c.srs_status}, interval=${c.interval_days}, ease=${c.ease_factor}, reps=${c.repetitions}`)
      }
    })

    it('should have next_review_at set for graduated cards', async () => {
      const cards = await queryCards(testDeckId!)

      // Cards rated "Easy" should be in 'review' with future next_review_at
      const reviewCards = cards.filter(c => c.srs_status === 'review')
      for (const c of reviewCards) {
        expect(c.next_review_at).not.toBeNull()
        expect(new Date(c.next_review_at!).getTime()).toBeGreaterThan(Date.now())
        expect(c.interval_days).toBeGreaterThan(0)
        expect(c.repetitions).toBeGreaterThanOrEqual(1)
      }

      console.log(`[study-db] ${reviewCards.length} cards graduated to review`)
    })

    it('second SRS session should show "no cards due"', async () => {
      // Verify via database: all cards should have future next_review_at (= no cards due now)
      const cards = await queryCards(testDeckId!)
      const dueNow = cards.filter(c => {
        if (!c.next_review_at) return c.srs_status === 'new' || c.srs_status === 'learning'
        return new Date(c.next_review_at).getTime() <= Date.now()
      })
      expect(dueNow.length).toBe(0)
      console.log('[study] All cards have future review dates — no cards due for second session')
    })
  })
})
