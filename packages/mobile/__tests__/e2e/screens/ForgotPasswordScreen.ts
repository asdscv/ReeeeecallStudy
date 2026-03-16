/**
 * Page Object: ForgotPasswordScreen
 */
class ForgotPasswordScreenPO {
  get screen() { return $('~forgot-password-screen') }
  get emailInput() { return $('~forgot-password-email-input') }
  get submitButton() { return $('~forgot-password-submit-button') }
  get errorText() { return $('~forgot-password-error-text') }
  get backButton() { return $('~forgot-password-back') }
  get successScreen() { return $('~forgot-password-success-screen') }

  async waitForScreen() {
    await this.screen.waitForDisplayed({ timeout: 10000 })
  }

  async requestReset(email: string) {
    await this.emailInput.setValue(email)
    await this.submitButton.click()
  }

  async tapBack() {
    await this.backButton.click()
  }

  async isSuccessDisplayed(): Promise<boolean> {
    await this.successScreen.waitForDisplayed({ timeout: 10000 })
    return this.successScreen.isDisplayed()
  }

  async isDisplayed(): Promise<boolean> {
    return this.screen.isDisplayed()
  }
}

export default new ForgotPasswordScreenPO()
