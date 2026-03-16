/**
 * Navigate to a tab by its label text.
 * React Navigation bottom tabs use labels like "Home, tab, 1 of 5"
 */
export async function navigateToTab(tabName: string) {
  // Try testID first
  const testIdTab = $(`~${tabName}Tab`)
  if (await testIdTab.isDisplayed().catch(() => false)) {
    await testIdTab.click()
    await browser.pause(1000)
    return
  }

  // iOS: match "TabName, tab, N of 5" pattern exactly
  const iosTab = $(`-ios predicate string:name CONTAINS ", tab," AND name BEGINSWITH "${tabName}"`)
  if (await iosTab.isDisplayed().catch(() => false)) {
    await iosTab.click()
    await browser.pause(1000)
    return
  }

  // Android: content-desc contains tab name
  const androidTab = $(`~${tabName}, tab`)
  if (await androidTab.isDisplayed().catch(() => false)) {
    await androidTab.click()
    await browser.pause(1000)
    return
  }

  // Last resort: find by exact accessibility label
  const labelTab = $(`~${tabName}`)
  if (await labelTab.isDisplayed().catch(() => false)) {
    await labelTab.click()
    await browser.pause(1000)
    return
  }

  console.log(`[nav] WARNING: Tab "${tabName}" not found`)
}
