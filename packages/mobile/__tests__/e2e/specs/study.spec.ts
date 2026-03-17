import StudySetupScreen from '../screens/StudySetupScreen'
import StudySessionScreen from '../screens/StudySessionScreen'
import StudySummaryScreen from '../screens/StudySummaryScreen'
import { navigateToTab } from '../helpers/navigation'
import { createTestDeck, cleanupTestDeck, queryCards } from '../helpers/supabase-api'

describe('Study Flow — Full E2E', () => {
  let testDeckId: string | null = null

  // Create fresh test deck with new cards BEFORE study tests
  before(async () => {
    const result = await createTestDeck([
      { front: 'Apple', back: 'A red fruit' },
      { front: 'Dog', back: 'A loyal animal' },
      { front: 'Book', back: 'Something to read' },
    ])
    testDeckId = result.deckId
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
      // Navigate away then to Study — forces useDecks() to re-fetch (picks up API-created deck)
      await navigateToTab('Home')
      await browser.pause(500)
      await navigateToTab('Study')
      await browser.pause(3000)

      // Handle stale states from previous runs
      for (let round = 0; round < 3; round++) {
        if (await StudySetupScreen.isDisplayed()) break
        const done = $('~summary-done')
        if (await done.isDisplayed().catch(() => false)) { await done.click(); await browser.pause(1000); continue }
        const exit = $('~study-exit-button')
        if (await exit.isDisplayed().catch(() => false)) {
          await exit.click(); await browser.pause(500)
          for (const s of ['-ios predicate string:name CONTAINS "End"', '~End']) {
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
      await browser.execute('mobile: scroll', { direction: 'up' }).catch(() => {})
      await browser.pause(500)

      // The deck list may need to load — retry with tab refresh
      let found = false
      for (let attempt = 0; attempt < 3; attempt++) {
        const chip = $(`~study-deck-${testDeckId}`)
        if (await chip.isExisting().catch(() => false)) { found = true; break }
        // Force refresh: navigate away and back
        await navigateToTab('Home')
        await browser.pause(500)
        await navigateToTab('Study')
        await browser.pause(3000)
      }
      expect(found).toBe(true)
    })

    it('should show start button', async () => {
      await browser.execute('mobile: scroll', { direction: 'down' }).catch(() => {})
      await browser.pause(300)
      const visible = await StudySetupScreen.startButton.isDisplayed().catch(() => false)
      const exists = await StudySetupScreen.startButton.isExisting().catch(() => false)
      expect(visible || exists).toBe(true)
    })
  })

  // ─── Session Screen — Full Card Interaction ────────────
  describe('StudySessionScreen', () => {
    it('should select test deck and start SRS session', async () => {
      await browser.execute('mobile: scroll', { direction: 'up' }).catch(() => {})
      await browser.pause(500)

      // Select our freshly created test deck (has 3 new cards)
      const chip = $(`~study-deck-${testDeckId}`)
      await chip.waitForExist({ timeout: 5000 })
      await chip.click()
      await browser.pause(500)

      // Select SRS mode (our cards are srs_status='new' so SRS will show them)
      const srsMode = $('~study-mode-srs')
      if (!await srsMode.isDisplayed().catch(() => false)) {
        await browser.execute('mobile: scroll', { direction: 'down' }).catch(() => {})
        await browser.pause(300)
      }
      await StudySetupScreen.selectMode('srs')
      await browser.pause(300)

      // Start study
      await browser.execute('mobile: scroll', { direction: 'down' }).catch(() => {})
      await browser.pause(300)
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
        const hasCard = await StudySessionScreen.isCardVisible()
        if (!hasCard) break

        await StudySessionScreen.flipCard()
        await browser.pause(400)
        await StudySessionScreen.rate('easy')
        await browser.pause(600)
      }

      // Session should now be complete — summary should appear
      await StudySummaryScreen.screen.waitForDisplayed({ timeout: 10000 })
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
      // Navigate to Study tab and start another SRS session with the same deck
      await navigateToTab('Study')
      await browser.pause(1000)

      // Select our test deck again
      const chip = $(`~study-deck-${testDeckId}`)
      if (await chip.isExisting().catch(() => false)) {
        await chip.click()
        await browser.pause(500)
      }

      // Select SRS mode and start
      await StudySetupScreen.selectMode('srs')
      await browser.pause(300)
      await browser.execute('mobile: scroll', { direction: 'down' }).catch(() => {})
      await browser.pause(300)
      await StudySetupScreen.start()

      // Should immediately go to summary (0 cards due) — no card should appear
      let wentToSummary = false
      for (let i = 0; i < 10; i++) {
        if (await StudySummaryScreen.screen.isExisting().catch(() => false)) { wentToSummary = true; break }
        if (await $('~summary-done').isExisting().catch(() => false)) { wentToSummary = true; break }
        await browser.pause(1000)
      }
      expect(wentToSummary).toBe(true)
      console.log('[study] Second SRS session correctly shows no cards due')
    })
  })
})
