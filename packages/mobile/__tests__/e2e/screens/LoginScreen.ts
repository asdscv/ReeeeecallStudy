/**
 * Page Object: LoginScreen
 * testID convention: {screen}-{element}-{type}
 */
class LoginScreenPO {
  // ── Selectors ──
  get screen() { return $('~login-screen') }
  get emailInput() { return $('~login-email-input') }
  get passwordInput() { return $('~login-password-input') }
  get submitButton() { return $('~login-submit-button') }
  get errorText() { return $('~login-error-text') }
  get forgotPasswordLink() { return $('~login-forgot-password') }
  get signUpLink() { return $('~login-signup-link') }
  get googleButton() { return $('~login-google-button') }
  get appleButton() { return $('~login-apple-button') }

  // ── Actions ──
  async waitForScreen() {
    await this.screen.waitForDisplayed({ timeout: 10000 })
  }

  async login(email: string, password: string) {
    await this.emailInput.setValue(email)
    await this.passwordInput.setValue(password)
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
