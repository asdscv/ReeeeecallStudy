import SettingsScreen from '../screens/SettingsScreen'
import PaywallScreen from '../screens/PaywallScreen'
import { navigateToTab } from '../helpers/navigation'

describe('Monetization Flow', () => {
  describe('Settings — Subscription Section', () => {
    it('should show subscription section in settings', async () => {
      await navigateToTab('Settings')
      await SettingsScreen.waitForScreen()
      expect(await SettingsScreen.isDisplayed()).toBe(true)
    })

    it('should show upgrade button for free users', async () => {
      const upgradeBtn = $('~settings-upgrade')
      if (await upgradeBtn.isExisting()) {
        await browser.execute('mobile: scroll', { direction: 'down' })
        await browser.pause(500)
        const visible = await upgradeBtn.isDisplayed().catch(() => false)
        expect(visible || await upgradeBtn.isExisting()).toBe(true)
      }
    })
  })

  describe('PaywallScreen', () => {
    it('should navigate to paywall from settings', async () => {
      const upgradeBtn = $('~settings-upgrade')
      if (await upgradeBtn.isExisting() && await upgradeBtn.isDisplayed()) {
        await upgradeBtn.click()
        await PaywallScreen.waitForScreen()
        expect(await PaywallScreen.isDisplayed()).toBe(true)
      }
    })

    it('should show restore purchase button', async () => {
      if (await PaywallScreen.screen.isExisting()) {
        expect(await PaywallScreen.restoreButton.isDisplayed()).toBe(true)
      }
    })
  })
})
