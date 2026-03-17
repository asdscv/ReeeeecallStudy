class StudySessionScreenPO {
  get screen() { return $('~study-session-screen') }
  get cardTap() { return $('~study-card-tap') }
  get cardArea() { return $('~study-card-area') }
  get exitButton() { return $('~study-exit-button') }
  get rateAgain() { return $('~study-rate-again') }
  get rateHard() { return $('~study-rate-hard') }
  get rateGood() { return $('~study-rate-good') }
  get rateEasy() { return $('~study-rate-easy') }

  /** Check if the study session is showing a card (any of the card selectors) */
  async isCardVisible(): Promise<boolean> {
    return (await this.cardTap.isDisplayed().catch(() => false)) ||
           (await this.cardArea.isDisplayed().catch(() => false))
  }

  async waitForScreen() {
    try {
      await this.screen.waitForDisplayed({ timeout: 8000 })
    } catch {
      // Screen container not accessible — check for card area or exit button
      try {
        await this.cardArea.waitForDisplayed({ timeout: 10000 })
      } catch {
        await this.exitButton.waitForDisplayed({ timeout: 5000 })
      }
    }
  }

  async isDisplayed() {
    return (await this.screen.isDisplayed().catch(() => false)) ||
           (await this.isCardVisible()) ||
           (await this.exitButton.isDisplayed().catch(() => false))
  }

  async flipCard() {
    // GestureDetector wraps the card — testID on TouchableOpacity may not be clickable.
    // Strategy: try multiple approaches in order of reliability.

    // 1. Try testID on TouchableOpacity
    if (await this.cardTap.isDisplayed().catch(() => false)) {
      await this.cardTap.click()
      return
    }

    // 2. Try "Tap to flip" text (inside the card, not blocked by GestureDetector)
    if (driver.isIOS) {
      const tapText = $('-ios predicate string:label == "Tap to flip"')
      if (await tapText.isDisplayed().catch(() => false)) {
        await tapText.click()
        return
      }
    }

    // 3. Tap card center by native tap (bypasses GestureDetector interception)
    const area = await this.cardArea
    if (await area.isDisplayed().catch(() => false)) {
      const loc = await area.getLocation()
      const size = await area.getSize()
      const centerX = Math.round(loc.x + size.width / 2)
      const centerY = Math.round(loc.y + size.height / 3)
      await browser.execute('mobile: tap', { x: centerX, y: centerY })
    }
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
