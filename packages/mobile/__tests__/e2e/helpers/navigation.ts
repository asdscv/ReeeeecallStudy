/**
 * Navigate to a tab by its label text.
 * iOS: class chain into TabBar buttons by index
 * Android: content-description / accessibility label
 */

const TAB_INDEX: Record<string, number> = {
  Home: 1,
  Decks: 2,
  Study: 3,
  Market: 4,
  Settings: 5,
}

export async function navigateToTab(tabName: string) {
  const idx = TAB_INDEX[tabName]
  if (!idx) {
    console.log(`[nav] Unknown tab: ${tabName}`)
    return
  }

  // Dismiss keyboard if visible (covers tab bar)
  if (driver.isIOS) {
    const keyboard = $('-ios class chain:**/XCUIElementTypeKeyboard')
    if (await keyboard.isDisplayed().catch(() => false)) {
      await $('-ios class chain:**/XCUIElementTypeOther[1]').click().catch(() => {})
      await browser.pause(500)
    }
  } else {
    try { await driver.hideKeyboard() } catch { /* no keyboard */ }
  }

  if (driver.isIOS) {
    // iOS: class chain to find Nth tab bar button
    const iosTab = $(`-ios class chain:**/XCUIElementTypeTabBar/XCUIElementTypeButton[${idx}]`)
    if (await iosTab.isDisplayed().catch(() => false)) {
      await iosTab.click()
      await browser.pause(1500)
      return
    }
  } else {
    // Android: find by content-description text
    const labels = [
      `${tabName}, tab, ${idx} of 5`,   // React Navigation format
      tabName,                            // plain label
      `${tabName}Tab`,                   // testID
    ]
    for (const label of labels) {
      const tab = $(`~${label}`)
      if (await tab.isDisplayed().catch(() => false)) {
        await tab.click()
        await browser.pause(1500)
        return
      }
    }
  }

  console.log(`[nav] WARNING: Tab "${tabName}" not found`)
}
