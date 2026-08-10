/**
 * Page Object: LoginScreen
 * testID convention: {screen}-{element}-{type}
 *
 * Android: TextInput components have a wrapper View and inner EditText,
 * both with the same testID. The ~ selector matches the wrapper (not the EditText).
 * For setValue, we need the actual EditText element.
 */
/**
 * On Android, address elements by RESOURCE-ID.
 *
 * `testProps` writes both `testID` and `accessibilityLabel`, so a bare View exposes the id as
 * content-desc too and `~id` happens to work. Anything with its own accessible text does not:
 * a TextInput's placeholder and a button's label OVERWRITE content-desc, so
 *
 *   <EditText resource-id="login-email-input"  content-desc="you@example.com">
 *   <Button   resource-id="login-submit-button" content-desc="Sign In">
 *
 * and `~login-submit-button` finds nothing. The resource-id is the only stable handle, and it
 * is locale-independent — content-desc here is a translated string.
 */
const byId = (id: string) =>
  driver.isIOS ? $(`~${id}`) : $(`android=new UiSelector().resourceId("${id}")`)

class LoginScreenPO {
  // ── Selectors ──
  get screen() { return byId('login-screen') }
  get emailInput() {
    if (driver.isIOS) return $('~login-email-input')
    // Android: match on RESOURCE-ID, not content-desc.
    //
    // `testProps` sets both `testID` and `accessibilityLabel`, so a plain View exposes the id
    // in both places — but a TextInput's PLACEHOLDER overwrites content-desc:
    //
    //   <EditText resource-id="login-email-input" content-desc="you@example.com" …>
    //
    // so `.description("login-email-input")` matched nothing and every Android run died in
    // the `before` hook, before a single assertion.
    return $('android=new UiSelector().className("android.widget.EditText").resourceId("login-email-input")')
  }
  get passwordInput() {
    if (driver.isIOS) return $('~login-password-input')
    return $('android=new UiSelector().className("android.widget.EditText").resourceId("login-password-input")')
  }
  get submitButton() { return byId('login-submit-button') }
  get errorText() { return byId('login-error-text') }
  get forgotPasswordLink() { return byId('login-forgot-password') }
  get signUpLink() { return byId('login-signup-link') }
  get googleButton() { return byId('login-google-button') }
  get appleButton() { return byId('login-apple-button') }

  // ── Actions ──
  async waitForScreen() {
    try {
      await this.screen.waitForDisplayed({ timeout: 10000 })
    } catch {
      // Android fallback: check for any login element
      await byId('login-submit-button').waitForDisplayed({ timeout: 5000 })
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
