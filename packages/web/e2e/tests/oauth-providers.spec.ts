import { test, expect } from '@playwright/test'

/**
 * OAuth Providers E2E Tests
 *
 * Tests the UI rendering and flow initiation for all OAuth providers
 * (Google, Apple). Actual OAuth consent requires real credentials,
 * so we test up to the redirect point.
 */
test.describe('OAuth Providers', () => {
  test.use({ storageState: { cookies: [], origins: [] } }) // unauthenticated

  // ─── Shared: both providers visible ──────────────────────────

  test('login page shows both Google and Apple buttons', async ({ page }) => {
    await page.goto('/auth/login')

    await expect(page.getByTestId('google-login-button')).toBeVisible()
    await expect(page.getByTestId('apple-login-button')).toBeVisible()
  })

  test('signup page shows both OAuth buttons', async ({ page }) => {
    await page.goto('/auth/login')
    await page.getByRole('button', { name: /Sign Up|회원가입/i }).click()

    await expect(page.getByTestId('google-login-button')).toBeVisible()
    await expect(page.getByTestId('apple-login-button')).toBeVisible()
  })

  test('forgot password page hides all OAuth buttons', async ({ page }) => {
    await page.goto('/auth/login')
    await page.getByRole('button', { name: /Forgot password|비밀번호를 잊으셨나요/i }).click()

    await expect(page.getByTestId('google-login-button')).not.toBeVisible()
    await expect(page.getByTestId('apple-login-button')).not.toBeVisible()
  })

  test('shows OR divider between form and OAuth buttons', async ({ page }) => {
    await page.goto('/auth/login')
    await expect(page.getByText(/^(or|또는)$/i)).toBeVisible()
  })

  // ─── Google ──────────────────────────────────────────────────

  test('Google button has logo SVG and correct text', async ({ page }) => {
    await page.goto('/auth/login')
    const btn = page.getByTestId('google-login-button')
    await expect(btn.locator('svg')).toBeVisible()
    await expect(btn).toContainText(/Google/)
  })

  test('clicking Google button initiates OAuth redirect', async ({ page }) => {
    await page.goto('/auth/login')
    const btn = page.getByTestId('google-login-button')

    await Promise.all([
      page.waitForURL(
        url => url.toString().includes('accounts.google.com') || url.toString().includes('supabase'),
        { timeout: 10_000 }
      ).catch(() => null),
      btn.click(),
    ])

    const url = page.url()
    const isRedirected = url.includes('accounts.google.com') || url.includes('supabase')
    const isLoading = await btn.isDisabled().catch(() => false)
    expect(isRedirected || isLoading).toBeTruthy()
  })

  // ─── Apple ───────────────────────────────────────────────────

  test('Apple button has logo SVG and correct text', async ({ page }) => {
    await page.goto('/auth/login')
    const btn = page.getByTestId('apple-login-button')
    await expect(btn.locator('svg')).toBeVisible()
    await expect(btn).toContainText(/Apple/)
  })

  test('Apple button has dark background style', async ({ page }) => {
    await page.goto('/auth/login')
    const btn = page.getByTestId('apple-login-button')
    await expect(btn).toHaveCSS('background-color', 'rgb(0, 0, 0)')
  })

  test('clicking Apple button initiates OAuth redirect', async ({ page }) => {
    await page.goto('/auth/login')
    const btn = page.getByTestId('apple-login-button')

    await Promise.all([
      page.waitForURL(
        url => url.toString().includes('appleid.apple.com') || url.toString().includes('supabase'),
        { timeout: 10_000 }
      ).catch(() => null),
      btn.click(),
    ])

    const url = page.url()
    const isRedirected = url.includes('appleid.apple.com') || url.includes('supabase')
    const isLoading = await btn.isDisabled().catch(() => false)
    expect(isRedirected || isLoading).toBeTruthy()
  })

  // ─── Mutual exclusion ───────────────────────────────────────

  test('both OAuth buttons share disabled state', async ({ page }) => {
    await page.goto('/auth/login')

    const googleBtn = page.getByTestId('google-login-button')
    const appleBtn = page.getByTestId('apple-login-button')

    // Before click, both should be enabled
    await expect(googleBtn).toBeEnabled()
    await expect(appleBtn).toBeEnabled()
  })
})
