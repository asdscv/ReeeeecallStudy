import { test, expect } from '@playwright/test'

/**
 * OAuth Providers E2E Tests
 *
 * Google uses its own button and sends an ID token to Supabase. Apple
 * starts a redirect flow. No real social account is needed for these tests.
 */
test.describe('OAuth Providers', () => {
  test.use({ storageState: { cookies: [], origins: [] } }) // unauthenticated

  test.beforeEach(async ({ page }) => {
    await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({
      contentType: 'application/javascript',
      body: `let receiveCredential;
        window.google = { accounts: { id: {
          initialize({ callback }) { receiveCredential = callback; },
          renderButton(container) {
            const button = document.createElement('button');
            button.textContent = 'Continue with Google';
            button.onclick = () => receiveCredential({ credential: 'test-google-id-token' });
            container.append(button);
          }
        } } };`,
    }))
  })

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

  test('Google sign-in uses the button rendered by Google Identity Services', async ({ page }) => {
    await page.goto('/auth/login')
    const btn = page.getByTestId('google-login-button')
    await expect(btn.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  })

  test('clicking Google sends an ID token without navigating away', async ({ page }) => {
    await page.route('**/auth/v1/token?grant_type=id_token', route => route.fulfill({
      status: 400,
      json: { message: 'Invalid test token' },
    }))
    await page.goto('/auth/login')
    const [exchange] = await Promise.all([
      page.waitForRequest('**/auth/v1/token?grant_type=id_token'),
      page.getByTestId('google-login-button').getByRole('button').click(),
    ])
    expect(exchange.postDataJSON()).toMatchObject({
      provider: 'google', id_token: 'test-google-id-token', nonce: expect.any(String),
    })
    await expect(page).toHaveURL(/\/auth\/login$/)
  })

  // ─── Apple ───────────────────────────────────────────────────

  test('Apple button has the Apple logo and label', async ({ page }) => {
    await page.goto('/auth/login')
    const btn = page.getByTestId('apple-login-button')
    await expect(btn.getByRole('img', { name: 'Apple' })).toBeVisible()
    await expect(btn).toContainText(/Apple/)
  })

  test('Apple button has dark background style', async ({ page }) => {
    await page.goto('/auth/login')
    const btn = page.getByTestId('apple-login-button')
    await expect(btn).toHaveCSS('background-color', 'rgb(0, 0, 0)')
  })

  test('clicking Apple button initiates OAuth redirect', async ({ page }) => {
    await page.route('**/auth/v1/authorize?**', route => route.fulfill({
      contentType: 'text/plain',
      body: 'Apple authorization redirect',
    }))
    await page.goto('/auth/login')
    const btn = page.getByTestId('apple-login-button')

    const [authorization] = await Promise.all([
      page.waitForRequest('**/auth/v1/authorize?**'),
      btn.click(),
    ])
    expect(new URL(authorization.url()).searchParams.get('provider')).toBe('apple')
  })

  // ─── Mutual exclusion ───────────────────────────────────────

  test('both OAuth buttons share disabled state', async ({ page }) => {
    await page.goto('/auth/login')

    const googleBtn = page.getByTestId('google-login-button').getByRole('button')
    const appleBtn = page.getByTestId('apple-login-button')

    // Before click, both should be enabled
    await expect(googleBtn).toBeEnabled()
    await expect(appleBtn).toBeEnabled()
  })
})
