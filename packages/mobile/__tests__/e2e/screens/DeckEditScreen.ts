import { scrollDown } from '../helpers/scroll'

/**
 * Dismiss keyboard on iOS/Android.
 * iOS: scroll down (side effect: dismisses keyboard) since hideKeyboard crashes WDA.
 * Android: use the native hideKeyboard command.
 */
async function dismissKeyboard() {
  if (driver.isIOS) {
    // Scroll the content to dismiss keyboard
    await scrollDown().catch(() => {})
  } else {
    try { await driver.hideKeyboard() } catch { /* no keyboard */ }
  }
  await browser.pause(500)
}

class DeckEditScreenPO {
  get screen() { return $('~deck-edit-screen') }
  get nameInput() { return $('~deck-edit-name') }
  get descriptionInput() { return $('~deck-edit-description') }
  get saveButton() { return $('~deck-edit-save') }

  /**
   * iOS: find TextInput using multiple strategies since `~` selector
   * may not find RNTextInput elements reliably on all iOS versions.
   */
  private async findNameInput(): Promise<WebdriverIO.Element> {
    // Android: use XPath to find the actual EditText (not the wrapper View)
    if (!driver.isIOS) {
      const byXpath = $('//android.widget.EditText[@resource-id="deck-edit-name"]')
      if (await byXpath.isExisting().catch(() => false)) return byXpath
    }

    // Strategy 1: standard ~ selector
    const byTestID = $('~deck-edit-name')
    if (await byTestID.isExisting().catch(() => false)) return byTestID

    if (driver.isIOS) {
      // Strategy 2: iOS predicate matching identifier
      const byPredicate = $('-ios predicate string:identifier == "deck-edit-name"')
      if (await byPredicate.isExisting().catch(() => false)) return byPredicate

      // Strategy 3: iOS predicate matching name/label
      const byLabel = $('-ios predicate string:name == "deck-edit-name" OR label == "deck-edit-name"')
      if (await byLabel.isExisting().catch(() => false)) return byLabel

      // Strategy 4: Find any TextField on the page (deck edit only has Name + Description)
      const textField = $('-ios class chain:**/XCUIElementTypeTextField')
      if (await textField.isExisting().catch(() => false)) return textField
    }

    return byTestID // fallback to original
  }

  private async findDescInput(): Promise<WebdriverIO.Element> {
    // Android: use XPath to find the actual EditText
    if (!driver.isIOS) {
      const byXpath = $('//android.widget.EditText[@resource-id="deck-edit-description"]')
      if (await byXpath.isExisting().catch(() => false)) return byXpath
    }

    const byTestID = $('~deck-edit-description')
    if (await byTestID.isExisting().catch(() => false)) return byTestID

    if (driver.isIOS) {
      const byPredicate = $('-ios predicate string:identifier == "deck-edit-description"')
      if (await byPredicate.isExisting().catch(() => false)) return byPredicate

      // Description is multiline = XCUIElementTypeTextView
      const textView = $('-ios class chain:**/XCUIElementTypeTextView')
      if (await textView.isExisting().catch(() => false)) return textView
    }

    return byTestID
  }

  async waitForScreen() {
    // Wait for the screen testID or any deck-edit element
    for (let i = 0; i < 15; i++) {
      if (await this.screen.isDisplayed().catch(() => false)) return
      if (await $('~deck-edit-name').isExisting().catch(() => false)) return
      // Android: check by resource-id
      if (!driver.isIOS) {
        if (await $('//android.widget.EditText[@resource-id="deck-edit-name"]').isExisting().catch(() => false)) return
        const source = await browser.getPageSource().catch(() => '')
        if (source.includes('deck-edit-name') || source.includes('New Deck')) return
      }
      if (driver.isIOS) {
        const byPredicate = $('-ios predicate string:identifier == "deck-edit-name"')
        if (await byPredicate.isExisting().catch(() => false)) return
        const textField = $('-ios class chain:**/XCUIElementTypeTextField')
        if (await textField.isExisting().catch(() => false)) {
          const source = await browser.getPageSource().catch(() => '')
          if (source.includes('New Deck') || source.includes('Edit Deck') || source.includes('deck-edit')) return
        }
      }
      await browser.pause(1000)
    }
    throw new Error('DeckEditScreen not found after 15s')
  }

  async isDisplayed(): Promise<boolean> {
    if (await this.screen.isDisplayed().catch(() => false)) return true
    const nameEl = await this.findNameInput()
    return (await nameEl.isDisplayed().catch(() => false)) ||
           (await nameEl.isExisting().catch(() => false))
  }

  async fillForm(name: string, description?: string) {
    const input = await this.findNameInput()
    // Wait for it to be interactable
    await input.waitForExist({ timeout: 5000 })
    await browser.pause(500) // let keyboard settle
    await input.setValue(name)
    if (description) {
      const descInput = await this.findDescInput()
      await descInput.setValue(description)
    }
    // Dismiss keyboard so save button is accessible
    await dismissKeyboard()
  }

  async save() {
    // Dismiss keyboard first
    await dismissKeyboard()

    // Scroll down to find save button
    for (let i = 0; i < 3; i++) {
      if (await this.saveButton.isDisplayed().catch(() => false)) break
      await scrollDown().catch(() => {})
      await browser.pause(300)
    }

    // Try click — isExisting fallback for off-screen but accessible elements
    const displayed = await this.saveButton.isDisplayed().catch(() => false)
    if (!displayed) {
      const existing = await this.saveButton.isExisting().catch(() => false)
      if (!existing) throw new Error('Save button not found')
    }
    await this.saveButton.click()
  }
}

export default new DeckEditScreenPO()
