import { scrollUp } from './scroll'

/**
 * Drawer testID mapping — language-independent, matches MainDrawer.tsx testID props.
 */
const DRAWER_TEST_IDS: Record<string, string> = {
  'Quick Study': 'drawer-quick-study',
  Dashboard: 'drawer-dashboard',
  Study: 'drawer-study-group',
  'AI Generate': 'drawer-ai-generate',
  Decks: 'drawer-decks',
  Cards: 'drawer-cards',
  Marketplace: 'drawer-marketplace',
  History: 'drawer-history',
  Settings: 'drawer-settings',
  Guide: 'drawer-guide',
}

/**
 * Open the drawer by tapping the hamburger (☰) button.
 */
export async function openDrawer() {
  // Try accessibility label
  const menuBtn = $('~Open menu')
  if (await menuBtn.isDisplayed().catch(() => false)) {
    await menuBtn.click()
    await browser.pause(800)
    return true
  }

  // iOS: find by class chain — look for the hamburger button area
  if (driver.isIOS) {
    const hamburger = $('-ios predicate string:label == "Open menu"')
    if (await hamburger.isDisplayed().catch(() => false)) {
      await hamburger.click()
      await browser.pause(800)
      return true
    }
    const textBtn = $('-ios predicate string:label CONTAINS "☰"')
    if (await textBtn.isDisplayed().catch(() => false)) {
      await textBtn.click()
      await browser.pause(800)
      return true
    }
  } else {
    const btn = $('android=new UiSelector().description("Open menu")')
    if (await btn.isDisplayed().catch(() => false)) {
      await btn.click()
      await browser.pause(800)
      return true
    }
    const textBtn = $('android=new UiSelector().text("☰")')
    if (await textBtn.isDisplayed().catch(() => false)) {
      await textBtn.click()
      await browser.pause(800)
      return true
    }
  }

  console.log('[nav] WARNING: Could not find hamburger button')
  return false
}

/**
 * Navigate to a screen via the drawer menu using testIDs (language-independent).
 */
export async function navigateToDrawerItem(itemName: string) {
  const studyGroupItems = ['AI Generate', 'Decks', 'Cards', 'Marketplace', 'History']
  const needsStudyGroup = studyGroupItems.includes(itemName)

  const opened = await openDrawer()
  if (!opened) {
    console.log(`[nav] Failed to open drawer for ${itemName}`)
    return false
  }

  // If item is inside Study group, expand it first
  if (needsStudyGroup) {
    await tapDrawerTestID('drawer-study-group')
    await browser.pause(1500) // Wait for group expansion animation + re-render

    // Verify the group expanded — retry once if needed
    const testID = DRAWER_TEST_IDS[itemName]
    if (testID) {
      const targetEl = $(`~${testID}`)
      if (!await targetEl.isExisting().catch(() => false)) {
        // Group might not have expanded — try tapping again
        await tapDrawerTestID('drawer-study-group')
        await browser.pause(1500)
      }
    }
  }

  // Tap the item by testID
  const testID = DRAWER_TEST_IDS[itemName]
  if (testID) {
    await tapDrawerTestID(testID)
  } else {
    // Fallback to text-based search
    await tapDrawerText(itemName)
  }
  await browser.pause(1000)
  return true
}

/**
 * Tap a drawer item by testID (language-independent).
 */
async function tapDrawerTestID(testID: string) {
  // Try accessibility id first (works on both platforms)
  const el = $(`~${testID}`)
  if (await el.isDisplayed().catch(() => false)) {
    await el.click()
    return
  }

  if (driver.isAndroid) {
    // Android: try resource-id
    const androidEl = $(`android=new UiSelector().resourceId("${testID}")`)
    if (await androidEl.isDisplayed().catch(() => false)) {
      await androidEl.click()
      return
    }
    const descEl = $(`android=new UiSelector().description("${testID}")`)
    if (await descEl.isDisplayed().catch(() => false)) {
      await descEl.click()
      return
    }
  }

  console.log(`[nav] WARNING: testID "${testID}" not found in drawer`)
}

/**
 * Fallback: tap a text element inside the drawer.
 */
async function tapDrawerText(text: string) {
  if (driver.isIOS) {
    const el = $(`-ios predicate string:label == "${text}"`)
    if (await el.isDisplayed().catch(() => false)) {
      await el.click()
      return
    }
    const partial = $(`-ios predicate string:label CONTAINS "${text}"`)
    if (await partial.isDisplayed().catch(() => false)) {
      await partial.click()
      return
    }
  } else {
    const el = $(`android=new UiSelector().text("${text}")`)
    if (await el.isDisplayed().catch(() => false)) {
      await el.click()
      return
    }
    const desc = $(`android=new UiSelector().description("${text}")`)
    if (await desc.isDisplayed().catch(() => false)) {
      await desc.click()
      return
    }
  }
  console.log(`[nav] WARNING: Text "${text}" not found in drawer`)
}

/**
 * Legacy: navigate to tab (wrapper for backward compat).
 */
export async function navigateToTab(tabName: string) {
  const mapping: Record<string, string> = {
    Home: 'Dashboard',
    Decks: 'Decks',
    Study: 'Quick Study',
    Market: 'Marketplace',
    Settings: 'Settings',
  }
  const drawerItem = mapping[tabName] ?? tabName
  return navigateToDrawerItem(drawerItem)
}
