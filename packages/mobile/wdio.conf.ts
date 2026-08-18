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
        // `~Open menu` 로 찾고 있었고, 그건 **한 번도 맞은 적이 없습니다.** 햄버거의
        // accessibilityLabel 은 번역된 문자열("메뉴 열기")이라 영어 라벨로는 절대 안 잡힙니다 —
        // 스위트 전체의 드로어 이동이 이것 때문에 죽어 있었고(PR #455), 같은 실수가 이 훅에
        // 남아 있었습니다. 잡을 것은 testID 입니다.
        const hamburger = $('~screen-header-menu')
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
