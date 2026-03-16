class StudySetupScreenPO {
  get screen() { return $('~study-setup-screen') }
  get startButton() { return $('~study-start-button') }

  async waitForScreen() {
    try {
      await this.screen.waitForDisplayed({ timeout: 5000 })
    } catch {
      await this.startButton.waitForDisplayed({ timeout: 10000 })
    }
  }
  async isDisplayed() {
    return (await this.screen.isDisplayed().catch(() => false)) ||
           (await this.startButton.isDisplayed().catch(() => false))
  }

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
