import { test as setup, expect } from '@playwright/test'

const AUTH_FILE = 'playwright/.auth/user.json'

setup('authenticate via browser login', async ({ page }) => {
  const email = process.env.E2E_TEST_EMAIL!
  const password = process.env.E2E_TEST_PASSWORD!

  if (!email || !password) {
    throw new Error(
      'Missing E2E env vars. Set E2E_TEST_EMAIL, E2E_TEST_PASSWORD in .env.test'
    )
  }

  // Navigate directly to login page
  await page.goto('/auth/login')

  // Fill in login form
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)

  // Submit
  await page.getByRole('button', { name: /Log In|로그인|login/i }).click()

  // Wait for navigation away from login page → dashboard
  await page.waitForURL(url => {
    const path = new URL(url).pathname
    return !path.includes('/auth') && !path.includes('/landing')
  }, { timeout: 15_000 })

  // Verify we're logged in
  await expect(page).not.toHaveURL(/\/landing|\/auth/)

  // Save authenticated state for all tests
  await page.context().storageState({ path: AUTH_FILE })
})
