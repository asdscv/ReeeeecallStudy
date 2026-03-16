import LoginScreen from '../screens/LoginScreen'
import SignUpScreen from '../screens/SignUpScreen'
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen'

describe('Auth Flow', () => {
  // ── Login Screen ──

  describe('LoginScreen', () => {
    it('should display login screen on app launch', async () => {
      await LoginScreen.waitForScreen()
      expect(await LoginScreen.isDisplayed()).toBe(true)
    })

    it('should show email and password inputs', async () => {
      expect(await LoginScreen.emailInput.isDisplayed()).toBe(true)
      expect(await LoginScreen.passwordInput.isDisplayed()).toBe(true)
    })

    it('should show social login buttons', async () => {
      expect(await LoginScreen.googleButton.isDisplayed()).toBe(true)
      expect(await LoginScreen.appleButton.isDisplayed()).toBe(true)
    })

    it('should show error on empty email submission', async () => {
      await LoginScreen.submitButton.click()
      const error = await LoginScreen.getErrorMessage()
      expect(error).toContain('email')
    })

    it('should show error on invalid credentials', async () => {
      await LoginScreen.login('invalid@test.com', 'wrongpassword123!')
      const error = await LoginScreen.getErrorMessage()
      expect(error.length).toBeGreaterThan(0)
    })

    it('should navigate to sign up screen', async () => {
      await LoginScreen.tapSignUp()
      await SignUpScreen.waitForScreen()
      expect(await SignUpScreen.isDisplayed()).toBe(true)
    })
  })

  // ── SignUp Screen ──

  describe('SignUpScreen', () => {
    before(async () => {
      // Navigate to SignUp from Login
      if (await LoginScreen.isDisplayed()) {
        await LoginScreen.tapSignUp()
      }
      await SignUpScreen.waitForScreen()
    })

    it('should display sign up form', async () => {
      expect(await SignUpScreen.nameInput.isDisplayed()).toBe(true)
      expect(await SignUpScreen.emailInput.isDisplayed()).toBe(true)
      expect(await SignUpScreen.passwordInput.isDisplayed()).toBe(true)
      expect(await SignUpScreen.confirmInput.isDisplayed()).toBe(true)
    })

    it('should navigate back to login', async () => {
      await SignUpScreen.tapLoginLink()
      await LoginScreen.waitForScreen()
      expect(await LoginScreen.isDisplayed()).toBe(true)
    })
  })

  // ── Forgot Password Screen ──

  describe('ForgotPasswordScreen', () => {
    before(async () => {
      // Navigate to ForgotPassword from Login
      if (!(await LoginScreen.isDisplayed())) {
        // Go back to login first
        await driver.back()
      }
      await LoginScreen.waitForScreen()
      await LoginScreen.tapForgotPassword()
      await ForgotPasswordScreen.waitForScreen()
    })

    it('should display forgot password form', async () => {
      expect(await ForgotPasswordScreen.emailInput.isDisplayed()).toBe(true)
      expect(await ForgotPasswordScreen.submitButton.isDisplayed()).toBe(true)
    })

    it('should navigate back to login', async () => {
      await ForgotPasswordScreen.tapBack()
      await LoginScreen.waitForScreen()
      expect(await LoginScreen.isDisplayed()).toBe(true)
    })
  })

  // ── Navigation Flow ──

  describe('Navigation', () => {
    it('should flow: Login → SignUp → Login', async () => {
      await LoginScreen.waitForScreen()
      await LoginScreen.tapSignUp()
      await SignUpScreen.waitForScreen()
      await SignUpScreen.tapLoginLink()
      await LoginScreen.waitForScreen()
      expect(await LoginScreen.isDisplayed()).toBe(true)
    })

    it('should flow: Login → ForgotPassword → Login', async () => {
      await LoginScreen.tapForgotPassword()
      await ForgotPasswordScreen.waitForScreen()
      await ForgotPasswordScreen.tapBack()
      await LoginScreen.waitForScreen()
      expect(await LoginScreen.isDisplayed()).toBe(true)
    })
  })
})
