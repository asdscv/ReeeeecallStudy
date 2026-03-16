import LoginScreen from '../screens/LoginScreen'

/**
 * Check if any bottom tab is visible (i.e. we're on the main screen).
 */
async function isMainScreenVisible(): Promise<string | null> {
  const tabNames = ['Home', 'Decks', 'Study', 'Market', 'Settings']

  for (const name of tabNames) {
    // Try testID
    if (await $(`~${name}Tab`).isDisplayed().catch(() => false)) {
      return name
    }
    // Try accessibility label (React Navigation format)
    if (await $(`~${name}`).isDisplayed().catch(() => false)) {
      return name
    }
  }

  // iOS: check tab bar exists
  if (driver.isIOS) {
    const tabBar = $('-ios class chain:**/XCUIElementTypeTabBar')
    if (await tabBar.isDisplayed().catch(() => false)) {
      return 'TabBar'
    }
  }

  return null
}

/**
 * Log in with test credentials before tests that require authentication.
 */
export async function loginIfNeeded() {
  await browser.pause(3000)

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
