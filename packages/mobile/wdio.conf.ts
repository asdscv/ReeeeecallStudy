/**
 * WebDriverIO shared config for Appium E2E tests.
 * Platform-specific configs extend this (wdio.ios.conf.ts, wdio.android.conf.ts).
 */
import dotenv from 'dotenv'
import path from 'path'

// E2E credentials are no longer committed. `.env.test` is gitignored and is the documented
// place for them; without this the helpers throw and the whole suite is unrunnable locally.
dotenv.config({ path: path.resolve(__dirname, '.env.test') })

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
    './__tests__/e2e/specs/quiz.spec.ts',
    './__tests__/e2e/specs/daily-check.spec.ts',
    './__tests__/e2e/specs/monetization.spec.ts',
    './__tests__/e2e/specs/remaining-features.spec.ts',
    './__tests__/e2e/specs/learning.spec.ts',
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

  /**
   * Replace Node's global fetch dispatcher with one from the undici that `webdriver` bundles.
   *
   * Node 26 installs an internal `Dispatcher1Wrapper` as the global dispatcher. `webdriver@9`
   * decides "anything whose constructor is not Agent/MockAgent must be a user-supplied
   * dispatcher" and forwards it into ITS OWN copy of undici, which rejects the foreign object
   * with `UND_ERR_INVALID_ARG`. The request never leaves the process — Appium logs nothing at
   * all, and the only symptom is "Failed to create a session", which is why this took a
   * bisect of the bundle to find. Handing it a real `Agent` puts wdio back on its own path.
   */
  beforeSession: async function () {
    const { Agent, setGlobalDispatcher } = await import('undici')
    setGlobalDispatcher(new Agent())
  },

  // Login + navigate to Home before each spec file
  // Ensures clean state regardless of how previous spec ended
  before: async function () {
    /**
     * 앱을 앞으로 가져옵니다.
     *
     * `terminateApp` + `activateApp` 로 화면 상태까지 확실히 되돌리는 안을 시도했다가 뺐습니다.
     * 되돌리기는 잘 되지만, iOS 세션이 실행 중에 끊기는 현상(ECONNRESET, "session is either
     * terminated or not started")을 **종료 없이도** 관측했기 때문에 원인으로 특정할 수 없었고,
     * 원인을 모르는 채로 세션을 더 흔드는 동작을 매 스펙마다 넣을 이유가 없습니다.
     *
     * 화면 되돌리기는 아래 드로어 감지에 맡깁니다 — 그게 지금까지 동작하지 않은 이유는
     * 셀렉터였습니다(아래 주석).
     */
    if (!driver.isIOS) {
      try {
        await driver.activateApp('com.reeeeecall.study')
      } catch { /* ignore — app may already be active */ }
    }

    // Wait for app to settle after session start (Metro refresh, splash screen, etc.)
    await browser.pause(3000)

    const { loginIfNeeded } = await import('./__tests__/e2e/helpers/auth')
    await loginIfNeeded()

    // After login, navigate to Home (Dashboard) to ensure consistent starting point.
    // App now uses drawer navigation (not bottom tabs).
    try {
      const { navigateToTab } = await import('./__tests__/e2e/helpers/navigation')

      // Try pressing back to get out of nested stack screens
      for (let i = 0; i < 3; i++) {
        // Check if we're on a main screen (has drawer hamburger)
        //
        // `~Open menu` 로 찾고 있었습니다. 한국어 iOS 에서는 라벨이 "메뉴 열기" 라 절대 안
        // 맞고, 못 찾으면 아래 루프가 **뒤로가기를 세 번 누릅니다** — Android 에서 그것은
        // 루트에서 앱을 종료시킵니다. 실제로 그렇게 됐습니다: 앱이 30초 만에 런처로 나가고
        // 그 뒤 모든 스펙이 "로그인 화면도 메인 화면도 없다"로 죽었습니다.
        //
        // 그리고 `~screen-header-menu` 로 바꾸는 것만으로는 부족합니다 — Android 에서 testID 는
        // resource-id 로 가고 content-desc 에는 번역된 라벨이 실립니다. 두 플랫폼을 같은
        // 헬퍼로 다룹니다.
        const { byPlatformId } = await import('./__tests__/e2e/helpers/navigation')
        const hamburger = byPlatformId('screen-header-menu')
        if (await hamburger.isDisplayed().catch(() => false)) break

        if (driver.isIOS) {
          const cancelBtn = $('-ios predicate string:label CONTAINS "Cancel" OR label CONTAINS "Back"')
          if (await cancelBtn.isDisplayed().catch(() => false)) {
            await cancelBtn.click().catch(() => {})
            await browser.pause(1000)
            continue
          }
        } else {
          try { await driver.back() } catch { /* ignore */ }
          await browser.pause(1000)
        }
        break
      }

      await navigateToTab('Home')
      await browser.pause(500)
    } catch { /* ignore — auth tests don't have drawer yet */ }
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
