class SettingsScreenPO {
  get screen() { return $('~settings-screen') }
  get displayName() { return $('~settings-display-name') }
  get ttsToggle() { return $('~settings-tts-toggle') }
  get logoutButton() { return $('~settings-logout') }

  async waitForScreen() {
    // settings-screen testID may not be accessible on iOS; fallback to display-name input
    try {
      await this.screen.waitForDisplayed({ timeout: 5000 })
    } catch {
      await this.displayName.waitForDisplayed({ timeout: 10000 })
    }
  }
  async isDisplayed() {
    return (await this.screen.isDisplayed().catch(() => false)) ||
           (await this.displayName.isDisplayed().catch(() => false))
  }
  async tapLogout() { await this.logoutButton.click() }
}

export default new SettingsScreenPO()
