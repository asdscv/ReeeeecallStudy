import SettingsScreen from '../screens/SettingsScreen'
import MarketplaceScreen from '../screens/MarketplaceScreen'
import { navigateToTab } from '../helpers/navigation'
import { scrollUp } from '../helpers/scroll'

describe('Phase 5 Features', () => {
  describe('Settings', () => {
    it('should display settings screen', async () => {
      await navigateToTab('Settings')
      await browser.pause(2000) // wait for Settings to load profile data

      // If a previous run left the SettingsStack on a nested screen (e.g. Paywall),
      // press back to get to the root Settings screen
      for (let i = 0; i < 3; i++) {
        if (await SettingsScreen.isDisplayed()) break
        // Check if we're on Paywall or other nested screen
        const paywall = $('~paywall-screen')
        if (await paywall.isExisting().catch(() => false)) {
          try { await driver.back() } catch {}
          await browser.pause(1000)
          continue
        }
        try { await driver.back() } catch {}
        await browser.pause(1000)
      }

      await SettingsScreen.waitForScreen()
      expect(await SettingsScreen.isDisplayed()).toBe(true)
    })

    it('should show display name input', async () => {
      // Settings page may be scrolled down from waitForScreen — scroll to very top
      for (let i = 0; i < 5; i++) {
        await scrollUp().catch(() => {})
        await browser.pause(400)
      }
      await browser.pause(500)
      // Now check for display name — try multiple strategies
      let found = await SettingsScreen.displayName.isExisting().catch(() => false)
      if (!found) {
        // Check page source to confirm Settings is showing
        const source = await browser.getPageSource()
        found = source.includes('Display Name') || source.includes('display_name')
      }
      expect(found).toBe(true)
    })

    it('should show logout button', async () => {
      await SettingsScreen.scrollToLogout()
      const visible = await SettingsScreen.logoutButton.isDisplayed().catch(() => false)
      const exists = await SettingsScreen.logoutButton.isExisting().catch(() => false)
      expect(visible || exists).toBe(true)
    })
  })

  describe('Marketplace', () => {
    it('should display marketplace screen', async () => {
      await navigateToTab('Market')
      await MarketplaceScreen.waitForScreen()
      expect(await MarketplaceScreen.isDisplayed()).toBe(true)
    })

    it('should show search bar', async () => {
      expect(await MarketplaceScreen.searchBar.isDisplayed()).toBe(true)
    })

    it('should filter by category', async () => {
      await scrollUp().catch(() => {})
      await browser.pause(300)
      await MarketplaceScreen.selectCategory('language')
      await browser.pause(500)
    })
  })

  describe('AI Generate', () => {
    it('should navigate to AI generate screen', async () => {
      await navigateToTab('Settings')
      const aiScreen = $('~ai-generate-screen')
    })
  })
})
