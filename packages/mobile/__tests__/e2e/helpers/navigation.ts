import { scrollUp } from './scroll'

/**
 * Drawer testID mapping — language-independent, matches MainDrawer.tsx testID props.
 */
const DRAWER_TEST_IDS: Record<string, string> = {
  'Quick Study': 'drawer-quick-study',
  Dashboard: 'drawer-dashboard',
  Study: 'drawer-study-group',
  // Nested under the Study group. The AI entries are GENERATED from the AI-hub catalog
  // (`drawer-ai-${entry.id}` in MainDrawer), so their ids move when the catalog does —
  // which is why `drawer-learning-plan` and `drawer-quiz` stopped resolving.
  'AI Hub': 'drawer-ai-hub',
  Quiz: 'drawer-ai-quiz',
  'Learning Plan': 'drawer-ai-learning_plan',
  'AI Generate': 'drawer-ai-generate',
  Decks: 'drawer-decks',
  Cards: 'drawer-cards',
  Marketplace: 'drawer-marketplace',
  History: 'drawer-history',
  Settings: 'drawer-settings',
  Guide: 'drawer-guide',
}

/**
 * iOS offers to save the password after a login and the sheet sits above everything,
 * swallowing the first taps of whatever spec runs next. Dismissing it is not optional.
 */
async function dismissIosSystemSheets() {
  // A brand-new account gets a six-step onboarding modal on first launch. It covers the whole
  // screen, so the header hamburger reports visible="false" and every drawer navigation fails
  // with "Could not find hamburger button" — which reads like a selector problem and is not.
  const skip = $('~onboarding-skip')
  if (await skip.isDisplayed().catch(() => false)) {
    await skip.click().catch(() => {})
    await browser.pause(1200)
  }

  if (!driver.isIOS) return
  for (const label of ['지금 안 함', 'Not Now', 'Cancel', '취소']) {
    const btn = $(`-ios predicate string:label == "${label}"`)
    if (await btn.isDisplayed().catch(() => false)) {
      await btn.click().catch(() => {})
      await browser.pause(600)
    }
  }
}

/**
 * Open the drawer by tapping the hamburger (☰) button.
 */
export async function openDrawer() {
  await dismissIosSystemSheets()

  // The real id, from the rendered tree. The `Open menu` selectors below it are historical:
  // the header renders `testID="screen-header-menu"` with a TRANSLATED accessibility label
  // ("메뉴 열기" in Korean), so matching on the English label found nothing and every drawer
  // navigation failed with "Could not find hamburger button".
  const headerMenu = $('~screen-header-menu')
  if (await headerMenu.isDisplayed().catch(() => false)) {
    await headerMenu.click()
    await browser.pause(900)
    return true
  }

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
/**
 * Which collapsible section holds each drawer item.
 *
 * AI 학습's header is a LINK to the hub, so its chevron carries the `-toggle` suffix; the other
 * three have no page of their own and their whole row toggles.
 */
const DRAWER_SECTION_OF: Record<string, string> = {
  'AI Hub': 'drawer-ai-hub-toggle',
  'Quiz': 'drawer-ai-hub-toggle',
  'Learning Plan': 'drawer-ai-hub-toggle',
  'AI Generate': 'drawer-ai-hub-toggle',
  'Decks': 'drawer-decks-section',
  'Cards': 'drawer-decks-section',
  'Marketplace': 'drawer-explore-section',
  'History': 'drawer-records-section',
  'Achievements': 'drawer-records-section',
}

export async function navigateToDrawerItem(itemName: string) {
  const studyGroupItems = ['AI Hub', 'Quiz', 'Learning Plan', 'AI Generate',
                           'Decks', 'Cards', 'Marketplace', 'History', 'Achievements']
  const needsStudyGroup = studyGroupItems.includes(itemName)

  const opened = await openDrawer()
  if (!opened) {
    console.log(`[nav] Failed to open drawer for ${itemName}`)
    return false
  }

  // If the item is inside the Study group, expand it first.
  //
  // POLLED, not slept. The group starts collapsed on every mount and the expansion is an
  // animation plus a re-render, so a fixed 1500ms wait is a coin flip on a loaded simulator
  // — and when it lost, the failure surfaced as "the item is missing", which reads like the
  // feature is broken rather than the drawer being shut. Three taps, each polled for two
  // seconds, and a report when it truly did not open.
  if (needsStudyGroup) {
    const testID = DRAWER_TEST_IDS[itemName]
    const visible = async () =>
      !testID || await $(`~${testID}`).isDisplayed().catch(() => false)

    // LOOK FIRST. The group header is a TOGGLE and `appium:noReset` keeps the drawer's
    // state between runs, so tapping unconditionally closes a group that was already open
    // — and an odd number of retries then leaves it closed, which surfaces as "the item
    // does not exist" and reads like the feature is missing.
    let expanded = await visible()
    for (let attempt = 0; attempt < 3 && !expanded; attempt++) {
      await tapDrawerTestID('drawer-study-group')
      // Polled, not slept: expansion is an animation plus a re-render, so a fixed wait is
      // a coin flip on a loaded simulator.
      for (let waited = 0; waited < 2500 && !expanded; waited += 250) {
        await browser.pause(250)
        expanded = await visible()
      }
    }
    // Then the SECTION. The four sections inside 학습 used to render expanded together — a
    // fifteen-row wall the moment the group opened — and they collapse now, one at a time. So a
    // group that is open is no longer enough; the item's own section has to be opened too, and
    // opening one closes another, which is why this looks first and taps once.
    if (!expanded) {
      const section = DRAWER_SECTION_OF[itemName]
      if (section) {
        await tapDrawerTestID(section)
        for (let waited = 0; waited < 2500 && !expanded; waited += 250) {
          await browser.pause(250)
          expanded = await visible()
        }
      }
    }

    if (!expanded) {
      console.log(`[nav] WARNING: study group never revealed ${itemName} (${testID})`)
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
