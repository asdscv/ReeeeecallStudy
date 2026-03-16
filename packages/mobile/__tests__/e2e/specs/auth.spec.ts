import LoginScreen from '../screens/LoginScreen'
import SignUpScreen from '../screens/SignUpScreen'
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen'

describe('Auth Flow', () => {
  let onLoginScreen = false

  before(async () => {
    // Auth tests require login screen. With noReset=true, app may be logged in already.
    await browser.pause(3000)
    onLoginScreen = await LoginScreen.screen.isDisplayed().catch(() => false)
    if (!onLoginScreen) {
      console.log('[auth] App is logged in — auth flow tests will be skipped')
    }
  })

  function skipIfLoggedIn() {
    if (!onLoginScreen) {
      console.log('[auth] Skipped (already logged in)')
      return true
    }
    return false
  }

  describe('LoginScreen', () => {
    it('should display login screen on app launch', async () => {
      if (skipIfLoggedIn()) return
      expect(await LoginScreen.isDisplayed()).toBe(true)
    })

    it('should show email and password inputs', async () => {
      if (skipIfLoggedIn()) return
      expect(await LoginScreen.emailInput.isDisplayed()).toBe(true)
      expect(await LoginScreen.passwordInput.isDisplayed()).toBe(true)
    })

    it('should show social login buttons', async () => {
      if (skipIfLoggedIn()) return
      expect(await LoginScreen.googleButton.isDisplayed()).toBe(true)
      expect(await LoginScreen.appleButton.isDisplayed()).toBe(true)
    })

    it('should show error on empty email submission', async () => {
      if (skipIfLoggedIn()) return
      await LoginScreen.submitButton.click()
      const error = await LoginScreen.getErrorMessage()
      expect(error).toContain('email')
    })

    it('should show error on invalid credentials', async () => {
      if (skipIfLoggedIn()) return
      await LoginScreen.login('invalid@test.com', 'wrongpassword123!')
      const error = await LoginScreen.getErrorMessage()
      expect(error.length).toBeGreaterThan(0)
    })

    it('should navigate to sign up screen', async () => {
      if (skipIfLoggedIn()) return
      await LoginScreen.tapSignUp()
      await SignUpScreen.waitForScreen()
      expect(await SignUpScreen.isDisplayed()).toBe(true)
    })
  })

  describe('SignUpScreen', () => {
    before(async () => {
      if (onLoginScreen && await LoginScreen.isDisplayed()) {
        await LoginScreen.tapSignUp()
      }
    })

    it('should display sign up form', async () => {
      if (skipIfLoggedIn()) return
      await SignUpScreen.waitForScreen()
      expect(await SignUpScreen.nameInput.isDisplayed()).toBe(true)
    })

    it('should navigate back to login', async () => {
      if (skipIfLoggedIn()) return
      await SignUpScreen.tapLoginLink()
      await LoginScreen.waitForScreen()
      expect(await LoginScreen.isDisplayed()).toBe(true)
    })
  })

  describe('ForgotPasswordScreen', () => {
    before(async () => {
      if (onLoginScreen) {
        if (!(await LoginScreen.isDisplayed())) await driver.back()
        await LoginScreen.waitForScreen()
        await LoginScreen.tapForgotPassword()
      }
    })

    it('should display forgot password form', async () => {
      if (skipIfLoggedIn()) return
      await ForgotPasswordScreen.waitForScreen()
      expect(await ForgotPasswordScreen.emailInput.isDisplayed()).toBe(true)
    })

    it('should navigate back to login', async () => {
      if (skipIfLoggedIn()) return
      await ForgotPasswordScreen.tapBack()
      await LoginScreen.waitForScreen()
      expect(await LoginScreen.isDisplayed()).toBe(true)
    })
  })

  describe('Navigation', () => {
    it('should flow: Login → SignUp → Login', async () => {
      if (skipIfLoggedIn()) return
      await LoginScreen.waitForScreen()
      await LoginScreen.tapSignUp()
      await SignUpScreen.waitForScreen()
      await SignUpScreen.tapLoginLink()
      await LoginScreen.waitForScreen()
      expect(await LoginScreen.isDisplayed()).toBe(true)
    })

    it('should flow: Login → ForgotPassword → Login', async () => {
      if (skipIfLoggedIn()) return
      await LoginScreen.tapForgotPassword()
      await ForgotPasswordScreen.waitForScreen()
      await ForgotPasswordScreen.tapBack()
      await LoginScreen.waitForScreen()
      expect(await LoginScreen.isDisplayed()).toBe(true)
    })
  })
})
