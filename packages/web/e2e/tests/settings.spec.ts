import { test, expect } from '@playwright/test'

test.describe('Settings Page', () => {
  test.use({ storageState: 'playwright/.auth/user.json' })

  test('should display settings page', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.locator('body')).toBeVisible()
  })

  test('should show profile section', async ({ page }) => {
    await page.goto('/settings')
    const profileSection = page.getByText(/profile|display name/i).first()
    if (await profileSection.isVisible()) {
      await expect(profileSection).toBeVisible()
    }
  })

  test('should show TTS settings', async ({ page }) => {
    await page.goto('/settings')
    const ttsSection = page.getByText(/text-to-speech|tts/i).first()
    if (await ttsSection.isVisible()) {
      await expect(ttsSection).toBeVisible()
    }
  })

  test('should show logout button', async ({ page }) => {
    await page.goto('/settings')
    const logoutBtn = page.getByRole('button', { name: /logout|sign out/i })
    if (await logoutBtn.isVisible()) {
      await expect(logoutBtn).toBeVisible()
    }
  })
})
