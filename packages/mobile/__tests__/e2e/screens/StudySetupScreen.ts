class StudySetupScreenPO {
  get screen() { return $('~study-setup-screen') }
  get startButton() { return $('~study-start-button') }

  async waitForScreen() {
    // Try multiple selectors — SafeAreaView testID not always accessible on iOS
    const selectors = [
      '~study-setup-screen',
      '~study-mode-srs',
      '~study-start-button',
    ]
    for (const sel of selectors) {
      try {
        await $(sel).waitForDisplayed({ timeout: 8000 })
        return
      } catch { /* try next */ }
    }
    // Last resort: scroll and retry
    await browser.execute('mobile: scroll', { direction: 'down' }).catch(() => {})
    await this.startButton.waitForDisplayed({ timeout: 5000 })
  }

  async isDisplayed() {
    return (await this.screen.isDisplayed().catch(() => false)) ||
           (await $('~study-mode-srs').isDisplayed().catch(() => false)) ||
           (await this.startButton.isDisplayed().catch(() => false))
  }

  async selectDeck(deckId: string) {
    const deckChip = $(`~study-deck-${deckId}`)
    await deckChip.click()
  }

  /** Select first available deck from the list */
  async selectFirstDeck() {
    // Find any deck chip (testID starts with "study-deck-")
    if (driver.isIOS) {
      const chip = $('-ios predicate string:name BEGINSWITH "study-deck-"')
      if (await chip.isDisplayed().catch(() => false)) {
        await chip.click()
        return true
      }
    }
    // Android / fallback: use $$ to find all deck chips
    const chips = await $$('[name^="study-deck-"]')
    if (chips.length > 0) {
      await chips[0].click()
      return true
    }
    return false
  }

  async selectMode(mode: string) {
    const modeCard = $(`~study-mode-${mode}`)
    await modeCard.waitForDisplayed({ timeout: 5000 })
    await modeCard.click()
  }

  async selectBatchSize(size: number) {
    const chip = $(`~study-batch-${size}`)
    await chip.click()
  }

  async start() {
    await this.startButton.waitForDisplayed({ timeout: 5000 })
    await this.startButton.click()
  }
}

export default new StudySetupScreenPO()
