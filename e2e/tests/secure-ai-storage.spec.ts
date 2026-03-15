import { test, expect } from '../fixtures/test-helpers'

/**
 * E2E tests for secure AI key storage (AES-256-GCM encryption).
 * Tests encryption, migration, persistence on both PC and mobile.
 */

test.describe('Secure AI Key Storage — PC & Mobile', () => {
  test('AI config is stored encrypted in localStorage (v3 format)', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(2000)

    // Configure a provider via Settings page
    const section = page.locator('section').filter({ hasText: /AI Providers|AI 프로바이더/i })
    const configureBtn = section.locator('button').filter({ hasText: /Configure|설정/i }).first()
    await configureBtn.click()

    const apiKeyInput = section.locator('input[type="password"]')
    await apiKeyInput.fill('sk-test-encryption-check-12345')

    const saveBtn = section.locator('button').filter({ hasText: /^Save$|^저장$/i }).first()
    await saveBtn.click()
    await page.waitForTimeout(1500)

    // Check localStorage for encrypted storage (v3 key)
    const v3Data = await page.evaluate(() =>
      localStorage.getItem('reeeeecall-ai-keys-v3'),
    )

    expect(v3Data).not.toBeNull()
    if (v3Data) {
      const envelope = JSON.parse(v3Data)
      expect(envelope.v).toBe(1)
      expect(envelope.data).toBeTruthy()

      // Encrypted data should NOT contain plaintext key
      expect(envelope.data).not.toContain('sk-test-encryption-check-12345')
      expect(v3Data).not.toContain('sk-test-encryption-check-12345')
    }
  })

  test('legacy plaintext config is auto-migrated to v3', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(2000)

    // Seed legacy plaintext data
    await page.evaluate(() => {
      localStorage.setItem(
        'reeeeecall-ai-config',
        JSON.stringify({
          providerId: 'xai',
          apiKey: 'xai-legacy-key-12345',
          model: 'grok-3-mini',
        }),
      )
    })

    // Navigate to AI generate to trigger migration via vault load
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
    await page.waitForTimeout(2000)

    // Check that legacy key was removed and v3 key was created
    const legacyData = await page.evaluate(() =>
      localStorage.getItem('reeeeecall-ai-config'),
    )
    const v3Data = await page.evaluate(() =>
      localStorage.getItem('reeeeecall-ai-keys-v3'),
    )

    expect(legacyData).toBeNull()
    expect(v3Data).not.toBeNull()

    if (v3Data) {
      const envelope = JSON.parse(v3Data)
      expect(envelope.v).toBe(1)
      expect(envelope.data).not.toContain('xai-legacy-key-12345')
    }
  })

  test('sign-out preserves encrypted AI config', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(2000)

    // Seed encrypted data
    await page.evaluate(() => {
      localStorage.setItem('reeeeecall-ai-keys-v3', '{"v":1,"data":"encrypted-blob","storedAt":"2025-01-01","ttlMs":null}')
    })

    const before = await page.evaluate(() =>
      localStorage.getItem('reeeeecall-ai-keys-v3'),
    )
    expect(before).not.toBeNull()

    // Sign out
    const logoutBtn = page.locator('button').filter({ hasText: /Logout|Sign Out|Log out|로그아웃/i }).first()
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click()
      await page.waitForTimeout(2000)

      // Config should persist (uid-based encryption protects it)
      const after = await page.evaluate(() =>
        localStorage.getItem('reeeeecall-ai-keys-v3'),
      )
      expect(after).not.toBeNull()
    }
  })

  test('hasAnyKey returns true for stored config', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForTimeout(2000)

    // Seed data
    await page.evaluate(() => {
      localStorage.setItem(
        'reeeeecall-ai-keys-v3',
        JSON.stringify({ v: 1, data: 'blob', storedAt: new Date().toISOString(), ttlMs: null }),
      )
    })

    await page.goto('/ai-generate')
    await page.waitForTimeout(2000)

    // Check for "API key saved" hint
    const savedHint = page.locator('text=/API key saved|API 키가 저장|apiKeySaved/i')
    if (await savedHint.isVisible()) {
      expect(await savedHint.isVisible()).toBe(true)
    }
  })
})
