class StudySetupScreenPO {
  get screen() { return $('~study-setup-screen') }
  get startButton() { return $('~study-start-button') }

  async waitForScreen() { await this.screen.waitForDisplayed({ timeout: 10000 }) }
  async isDisplayed() { return this.screen.isDisplayed() }

  async selectDeck(deckId: string) {
    const deckChip = $(`~study-deck-${deckId}`)
    await deckChip.click()
  }

  async selectMode(mode: string) {
    const modeCard = $(`~study-mode-${mode}`)
    await modeCard.click()
  }

  async selectBatchSize(size: number) {
    const chip = $(`~study-batch-${size}`)
    await chip.click()
  }

  async start() { await this.startButton.click() }
}

export default new StudySetupScreenPO()
