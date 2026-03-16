import { expect, type Page, type Locator } from '@playwright/test'
import { BasePage } from './base.page'

/**
 * Page Object for QuickStudyPage (/quick-study)
 * Handles deck selection → mode selection → configuration → start study
 */
export class QuickStudyPage extends BasePage {
  // ─── Locators ────────────────────────────────────────

  /** Deck selection grid */
  get deckGrid(): Locator {
    return this.page.locator('.grid')
  }

  /** Study mode selection modal */
  get modal(): Locator {
    return this.page.locator('.fixed.inset-0')
  }

  /** Start study button inside modal */
  get startStudyButton(): Locator {
    return this.modal.getByRole('button').filter({ hasText: /시작|Start/i })
  }

  /** Back button inside modal */
  get backButton(): Locator {
    return this.modal.getByRole('button').filter({ hasText: /←|Back|모드/i })
  }

  // ─── Actions ─────────────────────────────────────────

  constructor(page: Page) {
    super(page)
  }

  async navigate() {
    await this.goto('/quick-study')
    await this.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    await this.waitForLoadingToDisappear()
    // Wait for deck grid to be fully interactive
    await this.deckGrid.locator('button').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
    await this.page.waitForTimeout(500)
  }

  /** Select a deck by its name */
  async selectDeck(deckName: string) {
    const deckButton = this.page.getByRole('button', { name: new RegExp(deckName, 'i') })
    await deckButton.click()
    await expect(this.modal).toBeVisible()
  }

  /** Select the first available deck */
  async selectFirstDeck() {
    const firstDeck = this.deckGrid.locator('button').first()
    await firstDeck.waitFor({ state: 'visible', timeout: 10_000 })
    // Retry click until modal appears (handles React hydration race)
    for (let attempt = 0; attempt < 3; attempt++) {
      await firstDeck.click()
      const modalVisible = await this.modal.isVisible({ timeout: 2000 }).catch(() => false)
      if (modalVisible) return
      await this.page.waitForTimeout(500)
    }
    await expect(this.modal).toBeVisible({ timeout: 5000 })
  }

  /** Click a study mode option in the modal */
  async selectMode(modeEmoji: string) {
    const modeButton = this.modal.getByRole('button').filter({ hasText: modeEmoji })
    await modeButton.click()
  }

  /** Select cramming mode specifically */
  async selectCrammingMode() {
    await this.selectMode('⚡')
  }

  // ─── Cramming Setup ──────────────────────────────────

  /** Select a card filter in the cramming setup panel */
  async selectCrammingFilter(filterText: string) {
    const filterButton = this.modal.getByRole('button').filter({ hasText: new RegExp(filterText, 'i') })
    await filterButton.click()
  }

  /** Select a time limit preset */
  async selectTimeLimit(preset: string) {
    const timeLimitButton = this.modal.getByRole('button').filter({ hasText: new RegExp(preset, 'i') })
    await timeLimitButton.click()
  }

  /** Toggle the shuffle switch */
  async toggleShuffle() {
    const toggle = this.modal.locator('button.rounded-full')
    await toggle.click()
  }

  /** Verify cramming setup panel is visible */
  async expectCrammingSetupVisible() {
    // Should see filter options
    await expect(this.modal.getByText(/Card Filter|카드 필터|卡片筛选/i)).toBeVisible()
    // Should see time limit options
    await expect(this.modal.getByText(/Time Limit|시간 제한|时间限制/i)).toBeVisible()
  }

  /** Click the start study button */
  async startStudy() {
    await this.startStudyButton.click()
  }
}
