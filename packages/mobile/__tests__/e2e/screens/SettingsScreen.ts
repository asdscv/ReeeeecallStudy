class SettingsScreenPO {
  get screen() { return $('~settings-screen') }
  get displayName() { return $('~settings-display-name') }
  get ttsToggle() { return $('~settings-tts-toggle') }
  get logoutButton() { return $('~settings-logout') }

  async waitForScreen() { await this.screen.waitForDisplayed({ timeout: 10000 }) }
  async isDisplayed() { return this.screen.isDisplayed() }
  async tapLogout() { await this.logoutButton.click() }
}

export default new SettingsScreenPO()
