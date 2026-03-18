/**
 * WebDriverIO shared config for Appium E2E tests.
 * Platform-specific configs extend this (wdio.ios.conf.ts, wdio.android.conf.ts).
 */
export const config: WebdriverIO.Config = {
  runner: 'local',
  tsConfigPath: './tsconfig.json',

  // ── E2E spec execution order ──────────────────────────────────────
  // IMPORTANT: Ordered to avoid session conflicts.
  // - auth.spec runs first (may leave app on login screen)
  // - apple-oauth next (login screen tests)
  // - remaining specs require logged-in state
  // - study.spec MUST run LAST because createTestDeck() calls Supabase
  //   auth API separately, which can interfere with the app's session
  //   (project enforces single session per user — see register_session RPC)
  specs: [
    './__tests__/e2e/specs/auth.spec.ts',
    './__tests__/e2e/specs/apple-oauth.spec.ts',
    './__tests__/e2e/specs/decks.spec.ts',
    './__tests__/e2e/specs/features.spec.ts',
    './__tests__/e2e/specs/monetization.spec.ts',
    './__tests__/e2e/specs/remaining-features.spec.ts',
    './__tests__/e2e/specs/study.spec.ts',  // LAST — creates separate Supabase auth session
  ],
  exclude: [],

  maxInstances: 1,
  logLevel: 'warn',
  bail: 0,

  waitforTimeout: 10000,
  connectionRetryTimeout: 600000,
  connectionRetryCount: 3,

  framework: 'mocha',
  reporters: ['spec'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },

  // Login + navigate to Home before each spec file
  // Ensures clean state regardless of how previous spec ended
  before: async function () {
    // Ensure app is in foreground on Android
    if (!driver.isIOS) {
      try {
        await driver.activateApp('com.reeeeecall.study')
      } catch { /* ignore — app may already be active */ }
    }

    // Wait for app to settle after session start (Metro refresh, splash screen, etc.)
    await browser.pause(3000)

    const { loginIfNeeded } = await import('./__tests__/e2e/helpers/auth')
    await loginIfNeeded()

    // After login, navigate to Home tab to ensure consistent starting point
    // (previous spec may have left app on a different screen/tab)
    try {
      const { navigateToTab } = await import('./__tests__/e2e/helpers/navigation')

      // If app is on a stack screen (e.g. DeckEditScreen), tab bar is hidden.
      // Try pressing back to get to root tab screen first.
      if (driver.isIOS) {
        for (let i = 0; i < 3; i++) {
          const tabBar = $('-ios class chain:**/XCUIElementTypeTabBar')
          if (await tabBar.isDisplayed().catch(() => false)) break

          // Try back/cancel buttons
          const cancelBtn = $('-ios predicate string:label CONTAINS "Cancel" OR label CONTAINS "Back"')
          if (await cancelBtn.isDisplayed().catch(() => false)) {
            await cancelBtn.click().catch(() => {})
            await browser.pause(1000)
            continue
          }
          break
        }
      } else {
        // Android: use system back to get out of stack screens
        for (let i = 0; i < 3; i++) {
          const homeTab = $('~HomeTab')
          if (await homeTab.isDisplayed().catch(() => false)) break
          try { await driver.back() } catch { /* ignore */ }
          await browser.pause(1000)
        }
      }

      await navigateToTab('Home')
      await browser.pause(500)
    } catch { /* ignore — auth tests don't have tabs */ }
  },

  // Hooks for screenshots on failure
  afterTest: async function (test, _context, { error }) {
    if (error) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `${test.title.replace(/\s+/g, '_')}_${timestamp}`
      await browser.saveScreenshot(`./test-results/${filename}.png`)
    }
  },
}
