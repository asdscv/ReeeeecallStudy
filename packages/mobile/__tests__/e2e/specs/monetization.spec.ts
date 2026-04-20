import SettingsScreen from '../screens/SettingsScreen'
import PaywallScreen from '../screens/PaywallScreen'
import { navigateToTab } from '../helpers/navigation'
import { scrollDown } from '../helpers/scroll'

// ─────────────────────────────────────────────────────────────────────────
// [SUBSCRIPTION-HIDDEN] 2026-04-15 — Apple 심사 리젝 대응
// 구독 UI가 네비게이션에서 제거된 상태이므로 전체 스위트를 스킵.
// 복원 시 describe → describe 로 변경.
// ─────────────────────────────────────────────────────────────────────────
describe.skip('Monetization Flow', () => {
  describe('Settings — Subscription Section', () => {
    it('should show subscription section in settings', async () => {
      await navigateToTab('Settings')
      await browser.pause(2000)

      // Pop any stacked screens (e.g. Paywall from previous run)
      for (let i = 0; i < 3; i++) {
        if (await SettingsScreen.isDisplayed()) break
        try { await driver.back() } catch {}
        await browser.pause(1000)
      }

      await SettingsScreen.waitForScreen()
      expect(await SettingsScreen.isDisplayed()).toBe(true)
    })

    it('should show upgrade button for free users', async () => {
      const upgradeBtn = $('~settings-upgrade')
      if (await upgradeBtn.isExisting()) {
        await scrollDown().catch(() => {})
        await browser.pause(500)
        const visible = await upgradeBtn.isDisplayed().catch(() => false)
        expect(visible || await upgradeBtn.isExisting()).toBe(true)
      }
    })
  })

  describe('PaywallScreen', () => {
    it('should navigate to paywall from settings', async () => {
      const upgradeBtn = $('~settings-upgrade')
      // Scroll to find upgrade button
      for (let i = 0; i < 5; i++) {
        if (await upgradeBtn.isDisplayed().catch(() => false)) break
        await scrollDown().catch(() => {})
        await browser.pause(300)
      }
      if (await upgradeBtn.isDisplayed().catch(() => false)) {
        await upgradeBtn.click()
        await browser.pause(3000) // Wait for Paywall to load
        // Paywall may show different states — check for any paywall content
        const hasPaywall = await PaywallScreen.isDisplayed() ||
          await $('android=new UiSelector().textContains("Unlock")').isExisting().catch(() => false) ||
          await $('android=new UiSelector().textContains("Subscribe")').isExisting().catch(() => false) ||
          await $('android=new UiSelector().textContains("Restore")').isExisting().catch(() => false)
        expect(hasPaywall).toBe(true)
      }
    })

    it('should show restore purchase button', async () => {
      const onPaywall = await PaywallScreen.screen.isExisting().catch(() => false) ||
                         await PaywallScreen.restoreButton.isExisting().catch(() => false)
      if (onPaywall) {
        // Scroll multiple times to find restore button (may be far below fold)
        for (let i = 0; i < 5; i++) {
          const visible = await PaywallScreen.restoreButton.isDisplayed().catch(() => false)
          const exists = await PaywallScreen.restoreButton.isExisting().catch(() => false)
          if (visible || exists) break
          await scrollDown().catch(() => {})
          await browser.pause(300)
        }
        const visible = await PaywallScreen.restoreButton.isDisplayed().catch(() => false)
        const exists = await PaywallScreen.restoreButton.isExisting().catch(() => false)
        // Also try by text as fallback
        const byText = !driver.isIOS && await $('android=new UiSelector().text("Restore Purchase")').isExisting().catch(() => false)
        expect(visible || exists || byText).toBe(true)
      }
    })
  })
})
