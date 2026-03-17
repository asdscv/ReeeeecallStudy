import LoginScreen from '../screens/LoginScreen'

/**
 * Check if any bottom tab is visible (i.e. we're on the main screen).
 */
async function isMainScreenVisible(): Promise<string | null> {
  // Most reliable: check if the tab bar itself exists
  if (driver.isIOS) {
    const tabBar = $('-ios class chain:**/XCUIElementTypeTabBar')
    if (await tabBar.isDisplayed().catch(() => false)) {
      return 'TabBar'
    }
    // Tab bar might be hidden behind debugger banner — check for tab buttons
    const tabButtons = await $$('-ios class chain:**/XCUIElementTypeTabBar/XCUIElementTypeButton')
    if (tabButtons.length >= 3) {
      return 'TabBar'
    }
  }

  // Try tabBarTestID selectors
  const testIDs = ['HomeTab', 'DecksTab', 'StudyTab', 'MarketplaceTab', 'SettingsTab']
  for (const tid of testIDs) {
    if (await $(`~${tid}`).isDisplayed().catch(() => false)) {
      return tid.replace('Tab', '')
    }
  }

  // Try React Navigation labels
  const labels = ['Home', 'Decks', 'Study', 'Market', 'Settings']
  for (let i = 0; i < labels.length; i++) {
    const label = `${labels[i]}, tab, ${i + 1} of 5`
    if (await $(`~${label}`).isDisplayed().catch(() => false)) {
      return labels[i]
    }
  }

  return null
}

/**
 * Log in with test credentials before tests that require authentication.
 */
export async function loginIfNeeded() {
  await browser.pause(3000)

  // Scroll to top in case previous spec left the page scrolled down
  try { await browser.execute('mobile: scroll', { direction: 'up' }) } catch { /* ignore */ }
  await browser.pause(300)

  const foundTab = await isMainScreenVisible()
  if (foundTab) {
    console.log(`[auth] Already logged in (found ${foundTab})`)
    return
  }

  try {
    await LoginScreen.waitForScreen()
  } catch {
    console.log('[auth] Login screen not found, skipping login')
    return
  }

  const email = process.env.E2E_TEST_EMAIL || 'luke@rictax.kr'
  const password = process.env.E2E_TEST_PASSWORD || 'qpffkwldh35!'
  console.log(`[auth] Logging in as ${email}`)

  await LoginScreen.login(email, password)

  for (let i = 0; i < 15; i++) {
    const tab = await isMainScreenVisible()
    if (tab) {
      console.log(`[auth] Login success (found ${tab})`)
      return
    }
    await browser.pause(1000)
  }
  console.log('[auth] WARNING: Main screen not detected after login')
}
