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

    // 모드 목록은 덱을 고른 뒤에만 존재합니다. 닫혀 있으면 먼저 엽니다.
    if (!(await modeCard.isDisplayed().catch(() => false))) {
      const anyDeck = $('//*[starts-with(@name,"study-deck-")]')
      if (await anyDeck.isExisting().catch(() => false)) {
        await anyDeck.click().catch(() => {})
        await modeCard.waitForDisplayed({ timeout: 8000 }).catch(() => {})
      }
    }

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

  /**
   * 세션을 시작합니다.
   *
   * `srs` 는 모드를 고르는 순간 시작되므로 누를 버튼이 없습니다. 다른 모드는 2단계의
   * 시작 버튼을 눌러야 합니다. 호출부가 이 차이를 몰라도 되게 여기서 흡수합니다.
   */
  async start(mode = 'srs') {
    if (mode === 'srs') {
      await this.selectMode('srs')
      return
    }
    await this.selectMode(mode)
    await this.startButton.waitForDisplayed({ timeout: 8000 })
    await this.startButton.click()
  }

  /**
   * 시작 버튼이 있는 자리까지 데려갑니다.
   *
   * 화면이 이런 모양입니다: **덱 그리드 → 모드 모달 → (설정이 필요한 모드만) 2단계 + 시작 버튼.**
   * 그리고 `srs` 는 고르는 즉시 세션이 시작됩니다(`handleModeSelect`: "SRS starts immediately").
   * 그래서 SRS 로는 시작 버튼에 **영원히 닿을 수 없습니다** — 스펙이 그걸 기다리다 죽었습니다.
   *
   * 설정이 있는 모드를 골라야 버튼이 나옵니다. `random` 이 가장 단순합니다.
   */
  async openConfigStepForStartButton() {
    if (await this.startButton.isDisplayed().catch(() => false)) return

    // 모드 목록은 덱을 고른 뒤에만 존재합니다.
    const random = $('~study-mode-random')
    if (!(await random.isDisplayed().catch(() => false))) {
      const anyDeck = $('//*[starts-with(@name,"study-deck-")]')
      if (await anyDeck.isExisting().catch(() => false)) {
        await anyDeck.click().catch(() => {})
        await random.waitForDisplayed({ timeout: 8000 }).catch(() => {})
      }
    }
    if (await random.isDisplayed().catch(() => false)) {
      await random.click().catch(() => {})
      await this.startButton.waitForDisplayed({ timeout: 8000 }).catch(() => {})
    }
  }

  async scrollToStartButton() {
    if (await this.startButton.isDisplayed().catch(() => false)) return
    await this.openConfigStepForStartButton()
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
