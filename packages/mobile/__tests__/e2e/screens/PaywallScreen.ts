class PaywallScreenPO {
  get screen() { return $('~paywall-screen') }
  get monthlyButton() { return $('~paywall-monthly') }
  get annualButton() { return $('~paywall-annual') }
  get restoreButton() { return $('~paywall-restore') }
  get subscribeButton() { return $('~paywall-subscribe') }

  async waitForScreen() { await this.screen.waitForDisplayed({ timeout: 10000 }) }
  async isDisplayed() { return this.screen.isDisplayed() }
  async tapRestore() { await this.restoreButton.click() }
}

export default new PaywallScreenPO()
