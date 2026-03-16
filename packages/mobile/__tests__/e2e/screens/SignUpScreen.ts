/**
 * Page Object: SignUpScreen
 */
class SignUpScreenPO {
  get screen() { return $('~signup-screen') }
  get nameInput() { return $('~signup-name-input') }
  get emailInput() { return $('~signup-email-input') }
  get passwordInput() { return $('~signup-password-input') }
  get confirmInput() { return $('~signup-confirm-input') }
  get submitButton() { return $('~signup-submit-button') }
  get errorText() { return $('~signup-error-text') }
  get loginLink() { return $('~signup-login-link') }
  get successScreen() { return $('~signup-success-screen') }

  async waitForScreen() {
    await this.screen.waitForDisplayed({ timeout: 10000 })
  }

  async signUp(name: string, email: string, password: string) {
    await this.nameInput.setValue(name)
    await this.emailInput.setValue(email)
    await this.passwordInput.setValue(password)
    await this.confirmInput.setValue(password)
    await this.submitButton.click()
  }

  async tapLoginLink() {
    await this.loginLink.click()
  }

  async isSuccessDisplayed(): Promise<boolean> {
    await this.successScreen.waitForDisplayed({ timeout: 10000 })
    return this.successScreen.isDisplayed()
  }

  async isDisplayed(): Promise<boolean> {
    return this.screen.isDisplayed()
  }
}

export default new SignUpScreenPO()
