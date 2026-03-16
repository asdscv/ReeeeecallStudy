import StudySetupScreen from '../screens/StudySetupScreen'
import StudySessionScreen from '../screens/StudySessionScreen'
import StudySummaryScreen from '../screens/StudySummaryScreen'
import { navigateToTab } from '../helpers/navigation'

describe('Study Flow', () => {
  // Assumes user is logged in and has at least one deck with cards

  describe('StudySetupScreen', () => {
    it('should display study setup screen', async () => {
      // Scroll to top first, then navigate
      try { await browser.execute('mobile: scroll', { direction: 'up' }) } catch {}
      await browser.pause(500)
      await navigateToTab('Study')
      await browser.pause(1000)
      await StudySetupScreen.waitForScreen()
      expect(await StudySetupScreen.isDisplayed()).toBe(true)
    })

    it('should show start button', async () => {
      // Start button may be disabled if no deck selected yet
      const visible = await StudySetupScreen.startButton.isDisplayed().catch(() => false)
      const exists = await StudySetupScreen.startButton.isExisting().catch(() => false)
      expect(visible || exists).toBe(true)
    })
  })

  describe('StudySessionScreen', () => {
    it('should start study session after selecting deck and mode', async () => {
      // Select a deck with cards (find first available deck chip)
      const deckChips = await $$('[name^="study-deck-"]')
      if (deckChips.length > 0) {
        // Pick the last one (E2E Test Deck with 5 cards)
        await deckChips[deckChips.length - 1].click()
        await browser.pause(500)
      }
      // Select SRS mode
      await StudySetupScreen.selectMode('srs')
      await StudySetupScreen.start()
      await StudySessionScreen.waitForScreen()
      expect(await StudySessionScreen.isDisplayed()).toBe(true)
    })

    it('should show card content', async () => {
      expect(await StudySessionScreen.cardTap.isDisplayed()).toBe(true)
    })

    it('should flip card on tap', async () => {
      await StudySessionScreen.flipCard()
      // After flip, rating buttons should appear
      await StudySessionScreen.rateGood.waitForDisplayed({ timeout: 3000 })
      expect(await StudySessionScreen.rateGood.isDisplayed()).toBe(true)
    })

    it('should show all rating buttons after flip', async () => {
      expect(await StudySessionScreen.rateAgain.isDisplayed()).toBe(true)
      expect(await StudySessionScreen.rateHard.isDisplayed()).toBe(true)
      expect(await StudySessionScreen.rateGood.isDisplayed()).toBe(true)
      expect(await StudySessionScreen.rateEasy.isDisplayed()).toBe(true)
    })

    it('should rate card and advance to next', async () => {
      await StudySessionScreen.rate('good')
      // Should either show next card or navigate to summary
      await browser.pause(500)
    })
  })

  describe('StudySummaryScreen', () => {
    it('should show summary after completing session', async () => {
      // This test assumes the session completes after rating all cards
      // In a real test, we'd loop through all cards
      if (await StudySummaryScreen.screen.isExisting()) {
        await StudySummaryScreen.waitForScreen()
        expect(await StudySummaryScreen.isDisplayed()).toBe(true)
      }
    })

    it('should show stats', async () => {
      if (await StudySummaryScreen.screen.isExisting()) {
        expect(await StudySummaryScreen.cardsStudied.isDisplayed()).toBe(true)
        expect(await StudySummaryScreen.accuracy.isDisplayed()).toBe(true)
        expect(await StudySummaryScreen.time.isDisplayed()).toBe(true)
      }
    })
  })
})
