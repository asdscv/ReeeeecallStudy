class PaywallScreenPO {
  get screen() { return $('~paywall-screen') }
  get monthlyButton() { return $('~paywall-monthly') }
  get annualButton() { return $('~paywall-annual') }
  get restoreButton() { return $('~paywall-restore') }
  get subscribeButton() { return $('~paywall-subscribe') }

  async waitForScreen() {
    // Paywall may take time to load pricing data from RevenueCat
    try {
      await this.screen.waitForDisplayed({ timeout: 10000 })
    } catch {
      try {
        await this.subscribeButton.waitForDisplayed({ timeout: 10000 })
      } catch {
        // Android fallback: check for any paywall content by text
        const byText = $('android=new UiSelector().textContains("Subscribe")')
        await byText.waitForDisplayed({ timeout: 5000 })
      }
    }
  }
  async isDisplayed() {
    return (await this.screen.isDisplayed().catch(() => false)) ||
           (await this.subscribeButton.isDisplayed().catch(() => false)) ||
           (!driver.isIOS && await $('android=new UiSelector().textContains("Subscribe")').isDisplayed().catch(() => false))
  }
  async tapRestore() { await this.restoreButton.click() }
}

export default new PaywallScreenPO()
