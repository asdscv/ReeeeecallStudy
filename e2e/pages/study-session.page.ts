import { expect, type Page, type Locator } from '@playwright/test'
import { BasePage } from './base.page'

/**
 * Page Object for StudySessionPage (/decks/:deckId/study)
 * Handles card display, flipping, rating, progress, and summary.
 */
export class StudySessionPage extends BasePage {
  constructor(page: Page) {
    super(page)
  }

  // ─── Locators ────────────────────────────────────────

  /** The study card area */
  get studyCard(): Locator {
    return this.page.locator('[class*="cursor-pointer"]').first()
  }

  /** Exit (X) button */
  get exitButton(): Locator {
    return this.page.locator('button').filter({ has: this.page.locator('svg.w-5.h-5') })
  }

  // ─── Cramming-Specific Locators ──────────────────────

  /** Got It button (green) */
  get gotItButton(): Locator {
    return this.page.getByRole('button', { name: /Got It|알겠어요/i })
  }

  /** Didn't Get It button (red) */
  get missedButton(): Locator {
    return this.page.getByRole('button', { name: /Didn't Get It|모르겠어요|Get It/i }).first()
  }

  /** Cramming progress bar area (contains round badge + mastery) */
  get crammingProgressBar(): Locator {
    return this.page.locator('text=/Round|라운드/i').locator('..')
  }

  /** Round badge */
  get roundBadge(): Locator {
    return this.page.locator('.bg-purple-100')
  }

  /** Mastery percentage text */
  get masteryText(): Locator {
    return this.page.locator('.text-purple-600')
  }

  // ─── Summary Locators ────────────────────────────────

  /** Summary container (appears when session completes) */
  get summaryContainer(): Locator {
    return this.page.locator('text=/Complete|완료|Time.*Up|시간.*종료/i').locator('..')
  }

  /** "Cram Again" button on summary */
  get cramAgainButton(): Locator {
    return this.page.getByRole('button', { name: /Cram Again|다시 벼락치기/i })
  }

  /** "Back to Deck" button on summary */
  get backToDeckButton(): Locator {
    return this.page.getByRole('button', { name: /Back to Deck|덱으로/i })
  }

  /** SRS notice text on cramming summary */
  get srsNotice(): Locator {
    return this.page.locator('text=/SRS/i')
  }

  // ─── Actions ─────────────────────────────────────────

  /** Wait for the study session to load */
  async waitForSession() {
    // Wait for the session to leave loading state
    await this.page.waitForURL(/\/study\?/)
    // Wait for card or no-cards message
    await this.page.waitForSelector(
      'button:has-text("Got It"), button:has-text("알겠어요"), text=/No cards|카드가 없/i',
      { timeout: 15_000 }
    ).catch(() => {
      // If neither appears, wait for any content
    })
  }

  /** Flip the current card */
  async flipCard() {
    // Click on the card area to flip it — use "Tap to flip" hint or the card container
    const tapToFlip = this.page.locator('text=/Tap to flip|탭하여 뒤집기|눌러서/i')
    if (await tapToFlip.isVisible({ timeout: 2000 }).catch(() => false)) {
      await tapToFlip.click()
    } else {
      // Fallback: click the card container (rounded white area)
      await this.page.locator('.rounded-2xl, .rounded-3xl').first().click()
    }
  }

  /** Rate current card as "Got It" */
  async rateGotIt() {
    await this.gotItButton.click()
  }

  /** Rate current card as "Missed" */
  async rateMissed() {
    await this.missedButton.click()
  }

  /** Flip and rate as Got It in one action */
  async flipAndRateGotIt() {
    await this.flipCard()
    await this.gotItButton.waitFor({ state: 'visible', timeout: 5000 })
    await this.rateGotIt()
  }

  /** Flip and rate as Missed in one action */
  async flipAndRateMissed() {
    await this.flipCard()
    await this.missedButton.waitFor({ state: 'visible', timeout: 5000 })
    await this.rateMissed()
  }

  /** Use keyboard to flip and rate Got It */
  async keyboardFlipAndGotIt() {
    await this.page.keyboard.press('Space')  // flip
    await this.page.waitForTimeout(200)
    await this.page.keyboard.press('ArrowRight')  // got_it
  }

  /** Use keyboard to flip and rate Missed */
  async keyboardFlipAndMissed() {
    await this.page.keyboard.press('Space')  // flip
    await this.page.waitForTimeout(200)
    await this.page.keyboard.press('ArrowLeft')  // missed
  }

  // ─── Assertions ──────────────────────────────────────

  /** Verify cramming UI elements are displayed */
  async expectCrammingUI() {
    await expect(this.roundBadge).toBeVisible()
    await expect(this.masteryText).toBeVisible()
  }

  /** Verify the summary screen is shown */
  async expectSummaryVisible() {
    await expect(
      this.page.locator('text=/Complete|완료|Time.*Up|시간.*종료/i').first()
    ).toBeVisible({ timeout: 10_000 })
  }

  /** Verify the SRS notice is shown in cramming summary */
  async expectSrsNotice() {
    await expect(this.srsNotice.first()).toBeVisible()
  }

  /** Get the current round number from the badge */
  async getCurrentRound(): Promise<string> {
    const text = await this.roundBadge.textContent()
    return text ?? ''
  }

  /** Get the mastery percentage text */
  async getMasteryPercentage(): Promise<string> {
    const text = await this.masteryText.textContent()
    return text ?? ''
  }
}
