import { scrollUp, scrollDown } from '../helpers/scroll'

class SettingsScreenPO {
  get screen() { return $('~settings-screen') }
  get displayName() {
    // Android: testID maps to resource-id, not content-desc for EditText
    // Try accessibility selector first, then Android resource-id
    if (driver.isAndroid) {
      return $('android=new UiSelector().resourceId("settings-display-name")')
    }
    return $('~settings-display-name')
  }
  get ttsToggle() { return $('~settings-tts-toggle') }
  get logoutButton() { return $('~settings-logout') }

  async waitForScreen() {
    for (let i = 0; i < 10; i++) {
      if (await this.screen.isDisplayed().catch(() => false)) return
      if (await this.screen.isExisting().catch(() => false)) return
      if (await $('~settings-logout').isExisting().catch(() => false)) return
      if (await $('~settings-tts-toggle').isExisting().catch(() => false)) return
      // Check page source for Settings content
      if (i >= 3) {
        const source = await browser.getPageSource().catch(() => '')
        if (source.includes('Settings') && (source.includes('Logout') || source.includes('Display Name'))) return
      }
      await browser.pause(1000)
    }
  }

  async isDisplayed() {
    if (await this.screen.isDisplayed().catch(() => false)) return true
    if (await this.screen.isExisting().catch(() => false)) return true
    if (await $('~settings-logout').isExisting().catch(() => false)) return true
    // Check page source as final fallback
    const source = await browser.getPageSource().catch(() => '')
    return source.includes('Settings') && (source.includes('Logout') || source.includes('Display Name'))
  }

  async scrollToDisplayName() {
    for (let i = 0; i < 3; i++) {
      if (await this.displayName.isDisplayed().catch(() => false)) return
      if (await this.displayName.isExisting().catch(() => false)) return
      await scrollUp().catch(() => {})
      await browser.pause(500)
    }
  }

  async scrollToLogout() {
    // Try direct visibility first
    if (await this.logoutButton.isDisplayed().catch(() => false)) return

    if (driver.isAndroid) {
      // Use UiScrollable to scroll to the logout button (more reliable than manual swipe)
      try {
        const el = $('android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("settings-logout"))')
        await el.waitForExist({ timeout: 10000 })
        return
      } catch { /* fallback to manual scroll */ }
    }

    for (let i = 0; i < 10; i++) {
      if (await this.logoutButton.isDisplayed().catch(() => false)) return
      if (await this.logoutButton.isExisting().catch(() => false)) return
      await scrollDown().catch(() => {})
      await browser.pause(400)
    }
  }

  async tapLogout() {
    await this.scrollToLogout()
    await this.logoutButton.click()
  }
}

export default new SettingsScreenPO()
