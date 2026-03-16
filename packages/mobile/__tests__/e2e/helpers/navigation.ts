/**
 * Navigate to a tab by its label text.
 * React Navigation bottom tabs expose accessibility labels like "Settings, tab, 5 of 5"
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

  // React Navigation tab: "TabName, tab, N of 5"
  const label = `${tabName}, tab, ${idx} of 5`
  const tab = $(`~${label}`)
  if (await tab.isDisplayed().catch(() => false)) {
    await tab.click()
    await browser.pause(1000)
    return
  }

  // Fallback: testID
  const testIdTab = $(`~${tabName}Tab`)
  if (await testIdTab.isDisplayed().catch(() => false)) {
    await testIdTab.click()
    await browser.pause(1000)
    return
  }

  // Fallback: plain name
  const plainTab = $(`~${tabName}`)
  if (await plainTab.isDisplayed().catch(() => false)) {
    await plainTab.click()
    await browser.pause(1000)
    return
  }

  console.log(`[nav] WARNING: Tab "${tabName}" not found`)
}
