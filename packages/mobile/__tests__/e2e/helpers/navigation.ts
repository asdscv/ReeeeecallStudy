/**
 * Navigate to a tab by its label text.
 * React Navigation bottom tabs use labels like "Home, tab, 1 of 5"
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

  // Dismiss keyboard if visible (covers tab bar on iOS)
  const keyboard = $('-ios class chain:**/XCUIElementTypeKeyboard')
  if (await keyboard.isDisplayed().catch(() => false)) {
    // Tap outside to dismiss
    await $('-ios class chain:**/XCUIElementTypeOther[1]').click().catch(() => {})
    await browser.pause(500)
  }

  // iOS: Use class chain to find the Nth button in the tab bar
  const iosSelector = `**/XCUIElementTypeTabBar/XCUIElementTypeButton[${idx}]`
  const iosTab = $(`-ios class chain:${iosSelector}`)
  if (await iosTab.isDisplayed().catch(() => false)) {
    await iosTab.click()
    await browser.pause(1500)
    return
  }

  // Android: accessibility label
  const label = `${tabName}, tab, ${idx} of 5`
  const androidTab = $(`~${label}`)
  if (await androidTab.isDisplayed().catch(() => false)) {
    await androidTab.click()
    await browser.pause(1500)
    return
  }

  console.log(`[nav] WARNING: Tab "${tabName}" not found`)
}
