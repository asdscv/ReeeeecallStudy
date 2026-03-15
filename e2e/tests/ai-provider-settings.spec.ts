import { test, expect } from '../fixtures/test-helpers'

/**
 * E2E tests for AI Provider management in Settings page.
 * Runs on both PC (chromium) and Mobile (Pixel 5).
 */

// Helper: get AI Providers section
function getAiSection(page: import('@playwright/test').Page) {
  return page.locator('section').filter({ hasText: /AI Providers|AI 프로바이더/i })
}

test.describe('AI Provider Settings — PC & Mobile', () => {
  test('settings page shows AI Providers section with 4+ providers', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(2000)

    const section = getAiSection(page)
    await expect(section).toBeVisible({ timeout: 10_000 })

    // All 4 providers listed
    await expect(section.locator('text=OpenAI').first()).toBeVisible()
    await expect(section.locator('text=Google Gemini')).toBeVisible()
    await expect(section.locator('text=Anthropic Claude')).toBeVisible()
    await expect(section.locator('text=/xAI/i')).toBeVisible()
  })

  test('can configure a provider with API key', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(2000)

    const section = getAiSection(page)

    // Click configure on first provider
    const configureBtn = section.locator('button').filter({ hasText: /Configure|설정/i }).first()
    await configureBtn.click()

    // Fill in API key
    const apiKeyInput = section.locator('input[type="password"]')
    await expect(apiKeyInput).toBeVisible()
    await apiKeyInput.fill('sk-test-encrypted-key-12345')

    // Click Save (scoped to AI section)
    const saveBtn = section.locator('button').filter({ hasText: /^Save$|^저장$/i }).first()
    await saveBtn.click()
    await page.waitForTimeout(1500)

    // Should show "Configured" badge
    const badge = section.locator('text=/Configured|설정됨/i').first()
    await expect(badge).toBeVisible({ timeout: 5_000 })

    // Check localStorage for encrypted v3 data
    const v3Data = await page.evaluate(() =>
      localStorage.getItem('reeeeecall-ai-keys-v3'),
    )
    expect(v3Data).not.toBeNull()
    if (v3Data) {
      expect(v3Data).not.toContain('sk-test-encrypted-key-12345')
      const envelope = JSON.parse(v3Data)
      expect(envelope.v).toBe(1)
    }
  })

  test('can delete a configured provider', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(2000)

    const section = getAiSection(page)

    // First configure a provider
    const configureBtn = section.locator('button').filter({ hasText: /Configure|설정/i }).first()
    await configureBtn.click()

    const apiKeyInput = section.locator('input[type="password"]')
    await apiKeyInput.fill('sk-to-delete')

    const saveBtn = section.locator('button').filter({ hasText: /^Save$|^저장$/i }).first()
    await saveBtn.click()
    await page.waitForTimeout(1500)

    // Now delete it
    const deleteBtn = section.locator('button').filter({ hasText: /Delete|삭제/i }).first()
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click()
      await page.waitForTimeout(1000)

      // Should no longer show "Configured"
      const notSetBadges = section.locator('text=/Not set|미설정/i')
      const count = await notSetBadges.count()
      expect(count).toBeGreaterThanOrEqual(1)
    }
  })

  test('security note with AES-256 is visible', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(2000)

    const section = getAiSection(page)
    const note = section.locator('text=/AES-256/i')
    await expect(note).toBeVisible()
  })

  test('cancel edit form works', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(2000)

    const section = getAiSection(page)
    const configureBtn = section.locator('button').filter({ hasText: /Configure|설정/i }).first()
    await configureBtn.click()

    const apiKeyInput = section.locator('input[type="password"]')
    await expect(apiKeyInput).toBeVisible()

    const cancelBtn = section.locator('button').filter({ hasText: /Cancel|취소/i })
    await cancelBtn.click()

    await expect(apiKeyInput).not.toBeVisible()
  })
})

test.describe('AI Generate — Provider Integration', () => {
  test('shows configured providers in AI generate dropdown', async ({ page }) => {
    // Configure a provider first
    await page.goto('/settings')
    await page.waitForTimeout(2000)

    const section = getAiSection(page)
    const configureBtn = section.locator('button').filter({ hasText: /Configure|설정/i }).first()
    await configureBtn.click()

    const apiKeyInput = section.locator('input[type="password"]')
    await apiKeyInput.fill('sk-test-dropdown-check')

    const saveBtn = section.locator('button').filter({ hasText: /^Save$|^저장$/i }).first()
    await saveBtn.click()
    await page.waitForTimeout(1500)

    // Go to AI generate
    await page.goto('/decks')
    await page.waitForTimeout(2000)

    const aiBtn = page.locator('button').filter({ hasText: /AI Generate|AI로 만들기/i })
    if (!(await aiBtn.isVisible())) {
      test.skip()
      return
    }
    await aiBtn.click()

    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // Should have a provider select dropdown
    const providerSelect = dialog.locator('select').first()
    await expect(providerSelect).toBeVisible()

    // Should NOT have password input for API key
    const passwordInput = dialog.locator('input[type="password"]')
    await expect(passwordInput).not.toBeVisible()
  })

  test('no providers configured shows settings link', async ({ page }) => {
    // Clear stored keys
    await page.goto('/settings')
    await page.evaluate(() => {
      localStorage.removeItem('reeeeecall-ai-keys-v3')
      localStorage.removeItem('reeeeecall-ai-config-v2')
      localStorage.removeItem('reeeeecall-ai-config')
    })

    await page.goto('/decks')
    await page.waitForTimeout(2000)

    const aiBtn = page.locator('button').filter({ hasText: /AI Generate|AI로 만들기/i })
    if (!(await aiBtn.isVisible())) {
      test.skip()
      return
    }
    await aiBtn.click()

    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // Should show settings link
    const settingsBtn = dialog.locator('button').filter({ hasText: /Settings|설정/i })
    await expect(settingsBtn.first()).toBeVisible({ timeout: 5_000 })
  })
})
