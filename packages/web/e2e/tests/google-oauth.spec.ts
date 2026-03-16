import { test, expect } from '@playwright/test'

/**
 * Google OAuth Login E2E Tests
 *
 * These tests verify the Google login button UI and the OAuth flow initiation.
 * Since actual Google OAuth requires real Google credentials and consent screen,
 * we test up to the point of redirect to Google's auth page.
 */
test.describe('Google OAuth Login', () => {
  test.use({ storageState: { cookies: [], origins: [] } }) // unauthenticated

  test('login page shows Google login button', async ({ page }) => {
    await page.goto('/auth/login')

    const googleBtn = page.getByTestId('google-login-button')
    await expect(googleBtn).toBeVisible()
    await expect(googleBtn).toContainText(/Google/)
  })

  test('signup page also shows Google login button', async ({ page }) => {
    await page.goto('/auth/login')

    // Switch to signup mode
    await page.getByRole('button', { name: /Sign Up|회원가입/i }).click()

    const googleBtn = page.getByTestId('google-login-button')
    await expect(googleBtn).toBeVisible()
  })

  test('forgot password page does NOT show Google button', async ({ page }) => {
    await page.goto('/auth/login')

    // Switch to forgot password mode
    await page.getByRole('button', { name: /Forgot password|비밀번호를 잊으셨나요/i }).click()

    const googleBtn = page.getByTestId('google-login-button')
    await expect(googleBtn).not.toBeVisible()
  })

  test('shows OR divider between form and Google button', async ({ page }) => {
    await page.goto('/auth/login')

    // Check for the divider text
    const divider = page.getByText(/^(or|또는)$/i)
    await expect(divider).toBeVisible()
  })

  test('Google button has Google logo SVG', async ({ page }) => {
    await page.goto('/auth/login')

    const googleBtn = page.getByTestId('google-login-button')
    const svg = googleBtn.locator('svg')
    await expect(svg).toBeVisible()
  })

  test('clicking Google button initiates OAuth redirect', async ({ page }) => {
    await page.goto('/auth/login')

    const googleBtn = page.getByTestId('google-login-button')

    // Listen for navigation to Google's OAuth page
    const [popup] = await Promise.all([
      // Supabase OAuth may open in same tab or popup — wait for either
      page.waitForURL(
        url => url.toString().includes('accounts.google.com') || url.toString().includes('supabase'),
        { timeout: 10_000 }
      ).catch(() => null),
      googleBtn.click(),
    ])

    // After click, page should either:
    // 1. Redirect to Google's OAuth consent (accounts.google.com)
    // 2. Redirect to Supabase's auth endpoint which then redirects to Google
    // 3. Button becomes disabled (loading state) indicating the flow started
    const currentUrl = page.url()
    const isRedirected = currentUrl.includes('accounts.google.com') || currentUrl.includes('supabase')
    const isLoading = await googleBtn.isDisabled().catch(() => false)

    expect(isRedirected || isLoading).toBeTruthy()
  })
})
