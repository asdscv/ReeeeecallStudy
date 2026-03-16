import LoginScreen from '../screens/LoginScreen'

/**
 * Check if any bottom tab is visible (i.e. we're on the main screen).
 * Uses iOS predicate string matching for labels like "Home, tab, 1 of 5".
 */
async function isMainScreenVisible(): Promise<string | null> {
  const tabNames = ['Home', 'Decks', 'Study', 'Market', 'Settings']
  for (const name of tabNames) {
    // Try testID first
    if (await $(`~${name}Tab`).isDisplayed().catch(() => false)) {
      return name
    }
    // iOS predicate string: label begins with tab name
    if (await $(`-ios predicate string:name BEGINSWITH "${name}"`).isDisplayed().catch(() => false)) {
      return name
    }
  }
  return null
}

/**
 * Log in with test credentials before tests that require authentication.
 */
export async function loginIfNeeded() {
  // Wait for app to fully load
  await browser.pause(3000)

  // Check if already past login
  const foundTab = await isMainScreenVisible()
  if (foundTab) {
    console.log(`[auth] Already logged in (found ${foundTab} tab)`)
    return
  }

  // Wait for login screen
  try {
    await LoginScreen.waitForScreen()
  } catch {
    console.log('[auth] Login screen not found, skipping login')
    return
  }

  // Perform login
  const email = process.env.E2E_TEST_EMAIL || 'luke@rictax.kr'
  const password = process.env.E2E_TEST_PASSWORD || 'qpffkwldh35!'
  console.log(`[auth] Logging in as ${email}`)

  await LoginScreen.login(email, password)

  // Wait for navigation to main screen (up to 15s)
  for (let i = 0; i < 15; i++) {
    const tab = await isMainScreenVisible()
    if (tab) {
      console.log(`[auth] Login success (found ${tab} tab)`)
      return
    }
    await browser.pause(1000)
  }
  console.log('[auth] WARNING: Main screen not detected after login')
}
