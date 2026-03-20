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
    const modeSelector = `study-mode-${mode}`
    const modeCard = $(`~${modeSelector}`)

    if (driver.isAndroid) {
      try {
        const el = $(`android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().description("${modeSelector}"))`)
        await el.waitForExist({ timeout: 8000 })
        await el.click()
        return
      } catch { /* fallback */ }
    }

    for (let i = 0; i < 3; i++) {
      if (await modeCard.isDisplayed().catch(() => false)) break
      await scrollDown().catch(() => {})
      await browser.pause(300)
    }
    await modeCard.waitForDisplayed({ timeout: 5000 })
    await modeCard.click()
  }

  async start() {
    await this.scrollToStartButton()
    await this.startButton.waitForDisplayed({ timeout: 5000 })
    await this.startButton.click()
  }

  async scrollToStartButton() {
    if (await this.startButton.isDisplayed().catch(() => false)) return

    if (driver.isAndroid) {
      try {
        const el = $('android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().description("study-start-button"))')
        await el.waitForExist({ timeout: 8000 })
        return
      } catch { /* fallback */ }
    }

    for (let i = 0; i < 5; i++) {
      if (await this.startButton.isDisplayed().catch(() => false)) return
      await scrollDown().catch(() => {})
      await browser.pause(300)
    }
  }
}

export default new StudySetupScreenPO()
