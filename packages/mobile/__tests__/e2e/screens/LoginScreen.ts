/**
 * Page Object: LoginScreen
 * testID convention: {screen}-{element}-{type}
 *
 * Android: TextInput components have a wrapper View and inner EditText,
 * both with the same testID. The ~ selector matches the wrapper (not the EditText).
 * For setValue, we need the actual EditText element.
 */
class LoginScreenPO {
  // ── Selectors ──
  get screen() { return $('~login-screen') }
  get emailInput() {
    if (driver.isIOS) return $('~login-email-input')
    // Android: use UiSelector to find the EditText by content-desc (more reliable than XPath)
    return $('android=new UiSelector().className("android.widget.EditText").description("login-email-input")')
  }
  get passwordInput() {
    if (driver.isIOS) return $('~login-password-input')
    return $('android=new UiSelector().className("android.widget.EditText").description("login-password-input")')
  }
  get submitButton() { return $('~login-submit-button') }
  get errorText() { return $('~login-error-text') }
  get forgotPasswordLink() { return $('~login-forgot-password') }
  get signUpLink() { return $('~login-signup-link') }
  get googleButton() { return $('~login-google-button') }
  get appleButton() { return $('~login-apple-button') }

  // ── Actions ──
  async waitForScreen() {
    try {
      await this.screen.waitForDisplayed({ timeout: 10000 })
    } catch {
      // Android fallback: check for any login element
      await $('~login-submit-button').waitForDisplayed({ timeout: 5000 })
    }
  }

  async login(email: string, password: string) {
    // Clear any existing text first
    const emailEl = await this.emailInput
    await emailEl.click()
    await browser.pause(300)
    await emailEl.clearValue()
    await emailEl.setValue(email)
    await browser.pause(300)

    const passEl = await this.passwordInput
    await passEl.click()
    await browser.pause(300)
    await passEl.clearValue()
    await passEl.setValue(password)
    await browser.pause(300)

    // Dismiss keyboard before clicking submit
    try { await driver.hideKeyboard() } catch { /* no keyboard */ }
    await browser.pause(300)

    await this.submitButton.click()
  }

  async tapGoogleLogin() {
    await this.googleButton.click()
  }

  async tapAppleLogin() {
    await this.appleButton.click()
  }

  async tapForgotPassword() {
    await this.forgotPasswordLink.click()
  }

  async tapSignUp() {
    await this.signUpLink.click()
  }

  async getErrorMessage(): Promise<string> {
    await this.errorText.waitForDisplayed({ timeout: 5000 })
    return this.errorText.getText()
  }

  async isDisplayed(): Promise<boolean> {
    return this.screen.isDisplayed()
  }
}

export default new LoginScreenPO()
