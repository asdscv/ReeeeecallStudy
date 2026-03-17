class StudySessionScreenPO {
  get screen() { return $('~study-session-screen') }
  get cardTap() { return $('~study-card-tap') }
  get exitButton() { return $('~study-exit-button') }
  get rateAgain() { return $('~study-rate-again') }
  get rateHard() { return $('~study-rate-hard') }
  get rateGood() { return $('~study-rate-good') }
  get rateEasy() { return $('~study-rate-easy') }

  async waitForScreen() {
    try {
      await this.screen.waitForDisplayed({ timeout: 8000 })
    } catch {
      // Session screen container not accessible — check for card
      await this.cardTap.waitForDisplayed({ timeout: 15000 })
    }
  }
  async isDisplayed() {
    return (await this.screen.isDisplayed().catch(() => false)) ||
           (await this.cardTap.isDisplayed().catch(() => false))
  }

  async flipCard() {
    await this.cardTap.waitForDisplayed({ timeout: 5000 })
    await this.cardTap.click()
  }

  async rate(rating: 'again' | 'hard' | 'good' | 'easy') {
    const btn = $(`~study-rate-${rating}`)
    await btn.waitForDisplayed({ timeout: 5000 })
    await btn.click()
  }

  async exit() {
    await this.exitButton.waitForDisplayed({ timeout: 3000 })
    await this.exitButton.click()
  }
}

export default new StudySessionScreenPO()
