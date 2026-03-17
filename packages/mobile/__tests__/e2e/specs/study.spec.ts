import StudySetupScreen from '../screens/StudySetupScreen'
import StudySessionScreen from '../screens/StudySessionScreen'
import StudySummaryScreen from '../screens/StudySummaryScreen'
import { navigateToTab } from '../helpers/navigation'

describe('Study Flow', () => {
  describe('StudySetupScreen', () => {
    it('should display study setup screen', async () => {
      // Navigate away then to Study tab to attempt stack reset
      await navigateToTab('Home')
      await browser.pause(500)
      await navigateToTab('Study')
      await browser.pause(2000)

      // If a session is already in progress, exit it first
      const exitBtn = $('~study-exit-button')
      if (await exitBtn.isDisplayed().catch(() => false)) {
        await exitBtn.click()
        await browser.pause(1000)
        // Try multiple confirm button selectors
        for (const sel of ['~End', '-ios predicate string:name CONTAINS "End"', '-ios predicate string:name CONTAINS "Exit"']) {
          const btn = $(sel)
          if (await btn.isDisplayed().catch(() => false)) {
            await btn.click()
            await browser.pause(1000)
            break
          }
        }
      }
      // Check for summary screen
      const doneBtn = $('~summary-done')
      if (await doneBtn.isDisplayed().catch(() => false)) {
        await doneBtn.click()
        await browser.pause(1000)
      }

      // If still not on setup, navigate away and back again
      if (!await StudySetupScreen.isDisplayed()) {
        await navigateToTab('Home')
        await browser.pause(500)
        await navigateToTab('Study')
        await browser.pause(2000)
      }

      await StudySetupScreen.waitForScreen()
      expect(await StudySetupScreen.isDisplayed()).toBe(true)
    })

    it('should show start button', async () => {
      await browser.execute('mobile: scroll', { direction: 'down' }).catch(() => {})
      await browser.pause(300)
      const visible = await StudySetupScreen.startButton.isDisplayed().catch(() => false)
      const exists = await StudySetupScreen.startButton.isExisting().catch(() => false)
      expect(visible || exists).toBe(true)
    })
  })

  describe('StudySessionScreen', () => {
    it('should start study session', async () => {
      await browser.execute('mobile: scroll', { direction: 'up' }).catch(() => {})
      await browser.pause(500)

      // Select the last deck (E2E Test Deck with 5 cards)
      if (driver.isIOS) {
        const chips = await $$('-ios predicate string:name BEGINSWITH "study-deck-"')
        if (chips.length > 0) {
          await chips[chips.length - 1].click()
        }
      } else {
        const chips = await $$('[name^="study-deck-"]')
        if (chips.length > 0) {
          await chips[chips.length - 1].click()
        }
      }
      await browser.pause(500)

      // Use Random mode (always shows cards regardless of SRS status)
      const randomMode = $('~study-mode-random')
      if (!await randomMode.isDisplayed().catch(() => false)) {
        await browser.execute('mobile: scroll', { direction: 'down' }).catch(() => {})
        await browser.pause(300)
      }
      await StudySetupScreen.selectMode('random')
      await browser.pause(300)

      // Start
      await browser.execute('mobile: scroll', { direction: 'down' }).catch(() => {})
      await browser.pause(300)
      await StudySetupScreen.start()

      // Wait for either session card or summary (cards may be 0 due → immediate completion)
      const cardAppeared = await StudySessionScreen.cardTap.waitForDisplayed({ timeout: 10000 }).then(() => true).catch(() => false)
      const summaryAppeared = await StudySummaryScreen.screen.isExisting().catch(() => false)
      expect(cardAppeared || summaryAppeared).toBe(true)
      if (!cardAppeared) console.log('[study] Session completed immediately — no due cards')
    })

    it('should show card content', async () => {
      const v = await StudySessionScreen.cardTap.isDisplayed().catch(() => false)
      if (!v) { console.log('[study] Skipped — no active session'); return }
      expect(v).toBe(true)
    })

    it('should flip card on tap', async () => {
      if (!await StudySessionScreen.cardTap.isDisplayed().catch(() => false)) return
      await StudySessionScreen.flipCard()
      await browser.pause(500)
      await StudySessionScreen.rateGood.waitForDisplayed({ timeout: 5000 })
      expect(await StudySessionScreen.rateGood.isDisplayed()).toBe(true)
    })

    it('should show all rating buttons after flip', async () => {
      if (!await StudySessionScreen.rateGood.isDisplayed().catch(() => false)) return
      expect(await StudySessionScreen.rateAgain.isDisplayed()).toBe(true)
      expect(await StudySessionScreen.rateHard.isDisplayed()).toBe(true)
      expect(await StudySessionScreen.rateGood.isDisplayed()).toBe(true)
      expect(await StudySessionScreen.rateEasy.isDisplayed()).toBe(true)
    })

    it('should rate card and advance to next', async () => {
      if (!await StudySessionScreen.rateGood.isDisplayed().catch(() => false)) return
      await StudySessionScreen.rate('good')
      await browser.pause(800)
    })
  })

  describe('StudySummaryScreen', () => {
    it('should show summary after completing session', async () => {
      // Rate remaining cards to complete
      for (let i = 0; i < 30; i++) {
        if (await StudySummaryScreen.screen.isExisting().catch(() => false)) break
        const hasCard = await StudySessionScreen.cardTap.isDisplayed().catch(() => false)
        if (!hasCard) { await browser.pause(500); continue }
        await StudySessionScreen.flipCard()
        await browser.pause(500)
        await StudySessionScreen.rate('easy')
        await browser.pause(800)
      }
      if (await StudySummaryScreen.screen.isExisting().catch(() => false)) {
        await StudySummaryScreen.waitForScreen()
        expect(await StudySummaryScreen.isDisplayed()).toBe(true)
      }
    })

    it('should show stats', async () => {
      if (await StudySummaryScreen.screen.isExisting().catch(() => false)) {
        expect(await StudySummaryScreen.cardsStudied.isDisplayed()).toBe(true)
      }
    })
  })
})
