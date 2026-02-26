import { test, expect } from '../fixtures/test-helpers'

test.describe('ExportModal — Mode Tabs & Template Export', () => {

  /**
   * Navigate to a deck detail page.
   * Strategy: go to /decks, click the first deck card (div with cursor-pointer).
   */
  async function navigateToFirstDeck(page: import('@playwright/test').Page) {
    await page.goto('/decks')
    await page.waitForLoadState('networkidle')

    // DeckCard is a clickable div with cursor-pointer inside a grid
    const deckCard = page.locator('.grid > div.cursor-pointer').first()
    if (!(await deckCard.isVisible({ timeout: 5000 }).catch(() => false))) {
      return false
    }
    await deckCard.click()
    await page.waitForURL(/\/decks\//)
    await page.waitForLoadState('networkidle')
    return true
  }

  test('Export modal opens with correct title and mode tabs', async ({
    exportModalPage,
    page,
  }) => {
    const hasDeck = await navigateToFirstDeck(page)
    if (!hasDeck) {
      test.skip(true, 'No decks available for testing')
      return
    }

    await exportModalPage.openExportModal()

    // Dialog should be visible with title
    await expect(exportModalPage.dialog).toBeVisible()
    const title = await exportModalPage.dialogTitle.textContent()
    expect(title).toMatch(/내보내기|Export|Exportar|Ekspor|エクスポート|ส่งออก|Xuất|导出/i)

    // Both mode tabs should be visible
    await expect(exportModalPage.cardsTab).toBeVisible()
    await expect(exportModalPage.templateTab).toBeVisible()

    // Tabs have correct ARIA attributes
    await expect(exportModalPage.cardsTab).toHaveRole('tab')
    await expect(exportModalPage.templateTab).toHaveRole('tab')
  })

  test('Switching to template tab shows template panel and info banner', async ({
    exportModalPage,
    page,
  }) => {
    const hasDeck = await navigateToFirstDeck(page)
    if (!hasDeck) {
      test.skip(true, 'No decks available')
      return
    }

    await exportModalPage.openExportModal()

    // Switch to template tab
    await exportModalPage.selectTemplateTab()

    // Template tab should be selected
    await expect(exportModalPage.templateTab).toHaveAttribute('aria-selected', 'true')
    await expect(exportModalPage.cardsTab).toHaveAttribute('aria-selected', 'false')

    // Template panel and info banner should be visible
    await expect(exportModalPage.templatePanel).toBeVisible()
    await expect(exportModalPage.templateInfoBanner).toBeVisible()

    // Format selectors should be available
    await expect(exportModalPage.jsonRadio).toBeVisible()
    await expect(exportModalPage.csvRadio).toBeVisible()
  })

  test('Format selectors have correct ARIA radio semantics', async ({
    exportModalPage,
    page,
  }) => {
    const hasDeck = await navigateToFirstDeck(page)
    if (!hasDeck) {
      test.skip(true, 'No decks available')
      return
    }

    await exportModalPage.openExportModal()
    await exportModalPage.selectTemplateTab()

    // CSV should be selected by default
    await expect(exportModalPage.csvRadio).toHaveAttribute('aria-checked', 'true')
    await expect(exportModalPage.jsonRadio).toHaveAttribute('aria-checked', 'false')

    // Switch to JSON
    await exportModalPage.selectJSON()
    await expect(exportModalPage.jsonRadio).toHaveAttribute('aria-checked', 'true')
    await expect(exportModalPage.csvRadio).toHaveAttribute('aria-checked', 'false')
  })

  test('Template export triggers file download', async ({
    exportModalPage,
    page,
  }) => {
    const hasDeck = await navigateToFirstDeck(page)
    if (!hasDeck) {
      test.skip(true, 'No decks available')
      return
    }

    await exportModalPage.openExportModal()
    await exportModalPage.selectTemplateTab()

    // Expect CSV format (default)
    const downloadPromise = page.waitForEvent('download')
    await exportModalPage.clickExport()

    const download = await downloadPromise
    const fileName = download.suggestedFilename()

    // File should contain _template_ and .csv
    expect(fileName).toContain('_template_')
    expect(fileName).toMatch(/\.csv$/)

    // Done step should appear
    await expect(exportModalPage.confirmButton).toBeVisible()
  })

  test('Template JSON export produces .json download', async ({
    exportModalPage,
    page,
  }) => {
    const hasDeck = await navigateToFirstDeck(page)
    if (!hasDeck) {
      test.skip(true, 'No decks available')
      return
    }

    await exportModalPage.openExportModal()
    await exportModalPage.selectTemplateTab()
    await exportModalPage.selectJSON()

    const downloadPromise = page.waitForEvent('download')
    await exportModalPage.clickExport()

    const download = await downloadPromise
    const fileName = download.suggestedFilename()

    expect(fileName).toContain('_template_')
    expect(fileName).toMatch(/\.json$/)
  })

  test('Tab switch resets format to CSV', async ({
    exportModalPage,
    page,
  }) => {
    const hasDeck = await navigateToFirstDeck(page)
    if (!hasDeck) {
      test.skip(true, 'No decks available')
      return
    }

    await exportModalPage.openExportModal()
    await exportModalPage.selectTemplateTab()

    // Select JSON
    await exportModalPage.selectJSON()
    await expect(exportModalPage.jsonRadio).toHaveAttribute('aria-checked', 'true')

    // Switch to cards tab and back to template
    await exportModalPage.selectCardsTab()
    await exportModalPage.selectTemplateTab()

    // Format should reset to CSV
    await expect(exportModalPage.csvRadio).toHaveAttribute('aria-checked', 'true')
  })

  test('Cancel button closes the modal', async ({
    exportModalPage,
    page,
  }) => {
    const hasDeck = await navigateToFirstDeck(page)
    if (!hasDeck) {
      test.skip(true, 'No decks available')
      return
    }

    await exportModalPage.openExportModal()
    await expect(exportModalPage.dialog).toBeVisible()

    await exportModalPage.clickCancel()
    await expect(exportModalPage.dialog).not.toBeVisible()
  })

  test('Mobile: touch targets meet 44px minimum height', async ({
    exportModalPage,
    page,
  }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })

    const hasDeck = await navigateToFirstDeck(page)
    if (!hasDeck) {
      test.skip(true, 'No decks available')
      return
    }

    await exportModalPage.openExportModal()
    await exportModalPage.selectTemplateTab()

    // Check all interactive elements meet 44px minimum
    const interactiveElements = [
      exportModalPage.cardsTab,
      exportModalPage.templateTab,
      exportModalPage.submitButton,
      exportModalPage.cancelButton,
    ]

    for (const el of interactiveElements) {
      const box = await el.boundingBox()
      expect(box).not.toBeNull()
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(44)
      }
    }
  })

  test('Mobile: format cards stack vertically on small screens', async ({
    exportModalPage,
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 })

    const hasDeck = await navigateToFirstDeck(page)
    if (!hasDeck) {
      test.skip(true, 'No decks available')
      return
    }

    await exportModalPage.openExportModal()
    await exportModalPage.selectTemplateTab()

    const jsonBox = await exportModalPage.jsonRadio.boundingBox()
    const csvBox = await exportModalPage.csvRadio.boundingBox()

    expect(jsonBox).not.toBeNull()
    expect(csvBox).not.toBeNull()

    if (jsonBox && csvBox) {
      // On mobile, cards should be stacked (CSV below JSON)
      expect(csvBox.y).toBeGreaterThan(jsonBox.y)
    }
  })
})
