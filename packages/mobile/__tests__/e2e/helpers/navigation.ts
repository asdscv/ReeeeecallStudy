import { scrollUp } from './scroll'

/**
 * Tab name → index and actual tabBarTestID mapping.
 * React Navigation bottom tab accessibility label: "Label, tab, N of 5"
 * tabBarTestID + tabBarAccessibilityLabel values are defined in MainTabs.tsx.
 */
const TAB_MAP: Record<string, { idx: number; testID: string }> = {
  Home:     { idx: 1, testID: 'HomeTab' },
  Decks:    { idx: 2, testID: 'DecksTab' },
  Study:    { idx: 3, testID: 'StudyTab' },
  Market:   { idx: 4, testID: 'MarketplaceTab' },
  Settings: { idx: 5, testID: 'SettingsTab' },
}

export async function navigateToTab(tabName: string) {
  const tab = TAB_MAP[tabName]
  if (!tab) {
    console.log(`[nav] Unknown tab: ${tabName}`)
    return
  }

  // Dismiss React Native debugger warning banner if blocking tab bar
  if (driver.isIOS) {
    // Look for the "✕" dismiss button on the yellow/gray warning banner
    const dismissBanner = $('-ios predicate string:name == "✕" OR name == "×" OR name == "Close"')
    if (await dismissBanner.isDisplayed().catch(() => false)) {
      await dismissBanner.click()
      await browser.pause(500)
    }
    // Also try generic dismiss: tap X button at bottom-right of warning banner
    const xButton = $('-ios class chain:**/XCUIElementTypeOther[`label CONTAINS "debugger"`]/../XCUIElementTypeButton')
    if (await xButton.isDisplayed().catch(() => false)) {
      await xButton.click()
      await browser.pause(500)
    }
  }

  // Dismiss keyboard if covering tab bar
  if (driver.isIOS) {
    const keyboard = $('-ios class chain:**/XCUIElementTypeKeyboard')
    if (await keyboard.isDisplayed().catch(() => false)) {
      await $('-ios class chain:**/XCUIElementTypeOther[1]').click().catch(() => {})
      await browser.pause(500)
    }
  } else {
    try { await driver.hideKeyboard() } catch { /* no keyboard */ }
  }

  // 1. iOS class chain — Nth tab bar button (most reliable on iOS)
  //    Use isExisting() instead of isDisplayed() because debugger banner may obscure tab bar
  if (driver.isIOS) {
    const classChain = $(`-ios class chain:**/XCUIElementTypeTabBar/XCUIElementTypeButton[${tab.idx}]`)
    if (await classChain.isExisting().catch(() => false)) {
      await classChain.click()
      await browser.pause(1000)
      return
    }
  }

  // 2. React Navigation tab: "Label, tab, N of 5"
  const label = `${tabName}, tab, ${tab.idx} of 5`
  const labelTab = $(`~${label}`)
  if (await labelTab.isExisting().catch(() => false)) {
    await labelTab.click()
    await browser.pause(1000)
    return
  }

  // 3. tabBarTestID
  const testIdTab = $(`~${tab.testID}`)
  if (await testIdTab.isExisting().catch(() => false)) {
    await testIdTab.click()
    await browser.pause(1000)
    return
  }

  // 4. Plain name fallback
  const plainTab = $(`~${tabName}`)
  if (await plainTab.isExisting().catch(() => false)) {
    await plainTab.click()
    await browser.pause(1000)
    return
  }

  // Debug: dump what's visible
  console.log(`[nav] WARNING: Tab "${tabName}" not found — dumping debug info`)
  try {
    // Check if tab bar exists at all
    if (driver.isIOS) {
      const tabBar = $('-ios class chain:**/XCUIElementTypeTabBar')
      const tbVisible = await tabBar.isDisplayed().catch(() => false)
      console.log(`[nav] TabBar visible: ${tbVisible}`)
      if (tbVisible) {
        // Count tab bar buttons
        const buttons = await $$('-ios class chain:**/XCUIElementTypeTabBar/XCUIElementTypeButton')
        console.log(`[nav] TabBar buttons found: ${buttons.length}`)
        for (let i = 0; i < buttons.length; i++) {
          const label = await buttons[i].getAttribute('label').catch(() => '?')
          const name = await buttons[i].getAttribute('name').catch(() => '?')
          console.log(`[nav]   Button[${i}]: label="${label}" name="${name}"`)
        }
      }
    }
    await browser.saveScreenshot(`./e2e-debug-nav-${tabName}.png`)
  } catch (e) {
    console.log(`[nav] Debug failed: ${e}`)
  }
}
