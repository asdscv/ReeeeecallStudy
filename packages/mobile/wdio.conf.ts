/**
 * WebDriverIO shared config for Appium E2E tests.
 * Platform-specific configs extend this (wdio.ios.conf.ts, wdio.android.conf.ts).
 */
export const config: WebdriverIO.Config = {
  runner: 'local',
  tsConfigPath: './tsconfig.json',

  specs: ['./__tests__/e2e/specs/**/*.spec.ts'],
  exclude: [],

  maxInstances: 1,
  logLevel: 'warn',
  bail: 0,

  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  framework: 'mocha',
  reporters: ['spec'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
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
