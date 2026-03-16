import LoginScreen from '../screens/LoginScreen'

/**
 * Apple Sign-In E2E Tests (Mobile)
 *
 * Tests Apple login button visibility and tap behavior.
 * Actual Apple Sign-In requires a physical device with Apple ID,
 * so we verify up to the button interaction point.
 */
describe('Apple Sign-In', () => {
  before(async () => {
    await LoginScreen.waitForScreen()
  })

  it('should display Apple login button on login screen', async () => {
    expect(await LoginScreen.appleButton.isDisplayed()).toBe(true)
  })

  it('should display Google login button alongside Apple', async () => {
    expect(await LoginScreen.googleButton.isDisplayed()).toBe(true)
  })

  it('Apple button should be tappable', async () => {
    expect(await LoginScreen.appleButton.isEnabled()).toBe(true)
  })

  it('should show error or open auth when Apple button tapped', async () => {
    await LoginScreen.tapAppleLogin()

    // On simulator without Apple ID: expect error message
    // On real device: would open Apple auth sheet
    // Either outcome is valid — verify no crash
    await browser.pause(2000)

    // App should still be on login screen (not crashed)
    expect(await LoginScreen.isDisplayed()).toBe(true)
  })
})
