import type { Page, Locator } from '@playwright/test'

/**
 * Base Page Object — shared navigation and utility methods.
 * All page objects extend this class.
 */
export class BasePage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  // ─── Navigation ──────────────────────────────────────

  async goto(path: string) {
    await this.page.goto(path)
  }

  async waitForNavigation(urlPattern: string | RegExp) {
    await this.page.waitForURL(urlPattern)
  }

  // ─── Common Interactions ─────────────────────────────

  async clickButton(name: string) {
    await this.page.getByRole('button', { name }).click()
  }

  async clickLink(name: string) {
    await this.page.getByRole('link', { name }).click()
  }

  // ─── Assertions Helpers ──────────────────────────────

  async isVisible(locator: Locator): Promise<boolean> {
    return locator.isVisible()
  }

  async getText(locator: Locator): Promise<string> {
    return (await locator.textContent()) ?? ''
  }

  // ─── Wait Helpers ────────────────────────────────────

  async waitForLoadingToDisappear() {
    // Common pattern: wait for any loading spinner to disappear
    const spinner = this.page.locator('.animate-pulse, .animate-spin')
    if (await spinner.isVisible({ timeout: 1000 }).catch(() => false)) {
      await spinner.waitFor({ state: 'hidden', timeout: 10_000 })
    }
  }
}
