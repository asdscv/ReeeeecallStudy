class PaywallScreenPO {
  get screen() { return $('~paywall-screen') }
  get monthlyButton() { return $('~paywall-monthly') }
  get annualButton() { return $('~paywall-annual') }
  get restoreButton() { return $('~paywall-restore') }
  get subscribeButton() { return $('~paywall-subscribe') }

  async waitForScreen() {
    try {
      await this.screen.waitForDisplayed({ timeout: 5000 })
    } catch {
      await this.subscribeButton.waitForDisplayed({ timeout: 10000 })
    }
  }
  async isDisplayed() {
    return (await this.screen.isDisplayed().catch(() => false)) ||
           (await this.subscribeButton.isDisplayed().catch(() => false))
  }
  async tapRestore() { await this.restoreButton.click() }
}

export default new PaywallScreenPO()
