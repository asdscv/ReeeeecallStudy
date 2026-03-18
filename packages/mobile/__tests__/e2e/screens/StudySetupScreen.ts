import { scrollUp, scrollDown } from '../helpers/scroll'

class StudySetupScreenPO {
  get screen() { return $('~study-setup-screen') }
  get startButton() { return $('~study-start-button') }

  async waitForScreen() {
    const selectors = ['~study-setup-screen', '~study-mode-srs', '~study-start-button']
    for (const sel of selectors) {
      try {
        await $(sel).waitForDisplayed({ timeout: 8000 })
        return
      } catch { /* try next */ }
    }
    await scrollDown().catch(() => {})
    await this.startButton.waitForDisplayed({ timeout: 5000 })
  }

  async isDisplayed() {
    return (await this.screen.isDisplayed().catch(() => false)) ||
           (await $('~study-mode-srs').isDisplayed().catch(() => false)) ||
           (await this.startButton.isDisplayed().catch(() => false))
  }

  async selectDeck(deckId: string) {
    await scrollUp().catch(() => {})
    await browser.pause(300)
    const deckChip = $(`~study-deck-${deckId}`)
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await deckChip.isExisting().catch(() => false)) {
        await deckChip.click()
        return
      }
      await scrollDown().catch(() => {})
      await browser.pause(500)
    }
    await deckChip.waitForExist({ timeout: 5000 })
    await deckChip.click()
  }

  async selectMode(mode: string) {
    const modeCard = $(`~study-mode-${mode}`)
    for (let i = 0; i < 3; i++) {
      if (await modeCard.isDisplayed().catch(() => false)) break
      await scrollDown().catch(() => {})
      await browser.pause(300)
    }
    await modeCard.waitForDisplayed({ timeout: 5000 })
    await modeCard.click()
  }

  async start() {
    for (let i = 0; i < 3; i++) {
      if (await this.startButton.isDisplayed().catch(() => false)) break
      await scrollDown().catch(() => {})
      await browser.pause(300)
    }
    await this.startButton.waitForDisplayed({ timeout: 5000 })
    await this.startButton.click()
  }
}

export default new StudySetupScreenPO()
