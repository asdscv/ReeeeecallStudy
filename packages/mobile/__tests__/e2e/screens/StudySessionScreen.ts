class StudySessionScreenPO {
  get screen() { return $('~study-session-screen') }
  get cardTap() { return $('~study-card-tap') }
  get exitButton() { return $('~study-exit-button') }
  get rateAgain() { return $('~study-rate-again') }
  get rateHard() { return $('~study-rate-hard') }
  get rateGood() { return $('~study-rate-good') }
  get rateEasy() { return $('~study-rate-easy') }

  async waitForScreen() { await this.screen.waitForDisplayed({ timeout: 15000 }) }
  async isDisplayed() { return this.screen.isDisplayed() }

  async flipCard() { await this.cardTap.click() }

  async rate(rating: 'again' | 'hard' | 'good' | 'easy') {
    const btn = $(`~study-rate-${rating}`)
    await btn.waitForDisplayed({ timeout: 3000 })
    await btn.click()
  }

  async exit() { await this.exitButton.click() }
}

export default new StudySessionScreenPO()
