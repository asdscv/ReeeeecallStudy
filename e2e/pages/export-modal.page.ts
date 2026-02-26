import type { Page, Locator } from '@playwright/test'
import { BasePage } from './base.page'

/**
 * Page Object for the ExportModal component.
 * Encapsulates all export-related modal interactions.
 */
export class ExportModalPage extends BasePage {
  constructor(page: Page) {
    super(page)
  }

  // ─── Locators ────────────────────────────────────────

  /** The export button on the DeckDetail page (opens the modal) */
  get exportButton(): Locator {
    return this.page.getByRole('button', { name: /내보내기|Export/i }).first()
  }

  /** The dialog element (Radix Dialog) */
  get dialog(): Locator {
    return this.page.getByRole('dialog')
  }

  /** Dialog title */
  get dialogTitle(): Locator {
    return this.dialog.locator('h2, [class*="DialogTitle"]').first()
  }

  /** Mode tabs */
  get cardsTab(): Locator {
    return this.page.getByTestId('export-tab-cards')
  }

  get templateTab(): Locator {
    return this.page.getByTestId('export-tab-template')
  }

  /** Tab panels */
  get cardPanel(): Locator {
    return this.page.getByTestId('export-panel-cards')
  }

  get templatePanel(): Locator {
    return this.page.getByTestId('export-panel-template')
  }

  /** Format selection radio buttons */
  get jsonRadio(): Locator {
    return this.dialog.getByRole('radio', { name: /JSON/i })
  }

  get csvRadio(): Locator {
    return this.dialog.getByRole('radio', { name: /CSV/i })
  }

  /** Footer buttons */
  get cancelButton(): Locator {
    return this.dialog.getByRole('button', { name: /취소|Cancel/i })
  }

  get submitButton(): Locator {
    return this.page.getByTestId('export-submit')
  }

  /** Done step confirm button */
  get confirmButton(): Locator {
    return this.dialog.getByRole('button', { name: /확인|Done|Listo|Selesai|完了|เสร็จสิ้น|Xong|完成/i })
  }

  /** No-cards warning in cards tab */
  get noCardsWarning(): Locator {
    return this.dialog.locator('.bg-amber-50')
  }

  /** Template info banner (not the format selector button) */
  get templateInfoBanner(): Locator {
    return this.dialog.locator('div.bg-blue-50.border-blue-200')
  }

  // ─── Actions ─────────────────────────────────────────

  async openExportModal() {
    await this.exportButton.click()
    await this.dialog.waitFor({ state: 'visible' })
  }

  async selectCardsTab() {
    await this.cardsTab.click()
  }

  async selectTemplateTab() {
    await this.templateTab.click()
  }

  async selectJSON() {
    await this.jsonRadio.click()
  }

  async selectCSV() {
    await this.csvRadio.click()
  }

  async clickExport() {
    await this.submitButton.click()
  }

  async clickCancel() {
    await this.cancelButton.click()
  }

  async clickConfirm() {
    await this.confirmButton.click()
  }
}
