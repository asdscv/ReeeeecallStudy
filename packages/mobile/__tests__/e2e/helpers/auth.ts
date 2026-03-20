import LoginScreen from '../screens/LoginScreen'
import { scrollUp } from './scroll'

/**
 * Dismiss any Android system dialogs (ANR, crash) that may be blocking the UI.
 */
async function dismissAndroidDialogs() {
  if (driver.isIOS) return
  // Dismiss up to 5 stacked dialogs (system ANR, app ANR, crash, etc.)
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      // "App isn't responding" / "Process system isn't responding" → Click "Wait"
      const waitBtn = $('android=new UiSelector().resourceId("android:id/aerr_wait")')
      if (await waitBtn.isExisting().catch(() => false)) {
        await waitBtn.click()
        await browser.pause(1000)
        console.log('[auth] Dismissed ANR dialog (clicked Wait)')
        continue // check for more dialogs
      }
      // Also check for "OK" button on crash dialogs
      const okBtn = $('android=new UiSelector().text("OK").className("android.widget.Button")')
      if (await okBtn.isExisting().catch(() => false)) {
        await okBtn.click()
        await browser.pause(500)
        continue
      }
      // Dismiss notification shade if it's open (can happen from scrollUp swipe)
      const statusBar = $('android=new UiSelector().resourceId("com.android.systemui:id/quick_settings_panel")')
      if (await statusBar.isExisting().catch(() => false)) {
        try { await driver.back() } catch {}
        await browser.pause(500)
        continue
      }
      break // no more dialogs
    } catch { break }
  }
}

/**
 * Platform-aware element finder: uses ~ (content-desc) on iOS,
 * resource-id on Android (since testID maps to resource-id).
 */
function byTestId(id: string) {
  if (driver.isIOS) {
    return $(`~${id}`)
  }
  // Android: testID → resource-id (content-desc via accessibilityLabel may not always work)
  // Try content-desc first, then resource-id
  return $(`~${id}`)
}

/**
 * Android-specific: find element by resource-id (testID).
 */
function byResourceId(id: string) {
  return $(`android=new UiSelector().resourceId("${id}")`)
}

/**
 * Check if we're on a main screen (app uses drawer navigation, not bottom tabs).
 * Looks for the hamburger (☰) button or known screen testIDs.
 */
async function isMainScreenVisible(): Promise<string | null> {
  // Most reliable: check if the hamburger menu button is visible (drawer navigator)
  const hamburger = $('~Open menu')
  if (await hamburger.isDisplayed().catch(() => false)) {
    return 'DrawerScreen'
  }

  // Also check for known screen testIDs
  const screenIDs = ['dashboard-screen', 'decks-list-screen', 'study-setup-screen', 'marketplace-screen', 'settings-screen']
  for (const sid of screenIDs) {
    if (await $(`~${sid}`).isExisting().catch(() => false)) {
      return sid
    }
    // Android fallback: resource-id
    if (!driver.isIOS) {
      if (await byResourceId(sid).isExisting().catch(() => false)) {
        return sid
      }
    }
  }

  // Android: check by text for screen titles
  if (!driver.isIOS) {
    const titles = ['Dashboard', 'My Decks', 'Study Setup', 'Marketplace', 'Settings']
    for (const title of titles) {
      const el = $(`android=new UiSelector().text("${title}")`)
      if (await el.isDisplayed().catch(() => false)) {
        return title
      }
    }
  }

  return null
}

/**
 * Check if login screen is visible — try multiple strategies for Android compatibility.
 */
async function isLoginScreenVisible(): Promise<boolean> {
  // Direct testID (content-desc)
  if (await $('~login-screen').isDisplayed().catch(() => false)) return true

  // Check for login-specific elements (content-desc)
  if (await $('~login-email-input').isExisting().catch(() => false)) return true
  if (await $('~login-submit-button').isExisting().catch(() => false)) return true
  if (await $('~login-password-input').isExisting().catch(() => false)) return true

  // Android fallback: resource-id (testID maps to resource-id on Android)
  if (!driver.isIOS) {
    if (await byResourceId('login-email-input').isExisting().catch(() => false)) return true
    if (await byResourceId('login-submit-button').isExisting().catch(() => false)) return true
    // Also try by text
    if (await $('android=new UiSelector().text("Welcome back")').isExisting().catch(() => false)) return true
    if (await $('android=new UiSelector().text("Sign In")').isExisting().catch(() => false)) return true
  }

  return false
}

/**
 * Log in with test credentials before tests that require authentication.
 * Waits for the app to finish loading (auth guard / splash screen) before checking state.
 */
export async function loginIfNeeded() {
  // Dismiss any Android system dialogs (ANR/crash) that may block the UI
  await dismissAndroidDialogs()

  // Wait for the app to settle — auth loading / splash screen may take a while
  // Poll for up to 20 seconds until either login screen or main screen appears
  let foundTab: string | null = null
  let loginScreenVisible = false

  for (let i = 0; i < 20; i++) {
    await browser.pause(1000)

    // Keep dismissing dialogs that may pop up during loading
    if (i % 3 === 0) await dismissAndroidDialogs()

    foundTab = await isMainScreenVisible()
    if (foundTab) {
      console.log(`[auth] Already logged in (found ${foundTab})`)
      return
    }

    loginScreenVisible = await isLoginScreenVisible()
    if (loginScreenVisible) {
      console.log(`[auth] Login screen detected at ${i + 1}s`)
      break
    }

    if (i === 7) {
      // Try scrolling up in case we're stuck on some screen
      try { await scrollUp() } catch { /* ignore */ }
    }
  }

  if (!loginScreenVisible) {
    // One more check — maybe auth loaded during loop
    foundTab = await isMainScreenVisible()
    if (foundTab) {
      console.log(`[auth] Already logged in after wait (found ${foundTab})`)
      return
    }
    console.log('[auth] WARNING: Neither login screen nor main screen found after 20s wait')
    // Take debug screenshot
    await browser.saveScreenshot('./e2e-debug-auth-state.png').catch(() => {})
    return
  }

  const email = process.env.E2E_TEST_EMAIL || 'luke@rictax.kr'
  const password = process.env.E2E_TEST_PASSWORD || 'qpffkwldh35!'
  console.log(`[auth] Logging in as ${email}`)

  // Wait for login form elements to be fully ready before interacting
  await LoginScreen.emailInput.waitForDisplayed({ timeout: 10000 }).catch(() => {})
  await browser.pause(500)
  await LoginScreen.login(email, password)

  for (let i = 0; i < 20; i++) {
    const tab = await isMainScreenVisible()
    if (tab) {
      console.log(`[auth] Login success (found ${tab})`)
      return
    }
    await browser.pause(1000)
  }
  console.log('[auth] WARNING: Main screen not detected after login')
}
