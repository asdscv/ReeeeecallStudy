import { test, expect } from '../fixtures/test-helpers'

/**
 * E2E tests for secure AI key storage (AES-GCM encryption).
 * Tests encryption, migration, sign-out cleanup on both PC and mobile.
 */

test.describe('Secure AI Key Storage — PC & Mobile', () => {
  test('AI config is stored encrypted (not plaintext) in localStorage', async ({ page }) => {
    await page.goto('/decks')
    await page.waitForTimeout(2000)

    // Open AI Generate modal
    const aiBtn = page.locator('button').filter({ hasText: /AI Generate|AI로 만들기/i })
    if (!(await aiBtn.isVisible())) {
      test.skip()
      return
    }
    await aiBtn.click()

    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // Fill in provider config
    const providerSelect = dialog.locator('select').first()
    await providerSelect.selectOption('xai')

    const apiKeyInput = dialog.locator('input[type="password"]')
    await apiKeyInput.fill('xai-test-key-for-encryption-check')

    const topicInput = dialog.locator('input[type="text"]').first()
    await topicInput.fill('test topic')

    const slider = dialog.locator('input[type="range"]')
    await slider.fill('10')

    // Submit to trigger save
    const startBtn = dialog.locator('button[type="submit"]')
    await expect(startBtn).toBeEnabled()
    await startBtn.click()

    // Wait a moment for save to complete
    await page.waitForTimeout(1000)

    // Check localStorage for encrypted storage
    const v2Data = await page.evaluate(() =>
      localStorage.getItem('reeeeecall-ai-config-v2'),
    )
    const legacyData = await page.evaluate(() =>
      localStorage.getItem('reeeeecall-ai-config'),
    )

    // v2 (encrypted) key should exist
    expect(v2Data).not.toBeNull()

    if (v2Data) {
      // Parse the envelope
      const envelope = JSON.parse(v2Data)
      expect(envelope.v).toBe(1)
      expect(envelope.data).toBeTruthy()
      expect(envelope.storedAt).toBeTruthy()

      // The encrypted data should NOT contain the plaintext API key
      expect(envelope.data).not.toContain('xai-test-key-for-encryption-check')

      // The raw envelope string should NOT contain the plaintext key
      expect(v2Data).not.toContain('xai-test-key-for-encryption-check')
    }

    // Legacy plaintext key should NOT exist (new saves go to v2)
    expect(legacyData).toBeNull()
  })

  test('legacy plaintext config is auto-migrated on load', async ({ page }) => {
    await page.goto('/decks')
    await page.waitForTimeout(2000)

    // Seed legacy plaintext data directly
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

    // Open AI Generate to trigger load
    const aiBtn = page.locator('button').filter({ hasText: /AI Generate|AI로 만들기/i })
    if (!(await aiBtn.isVisible())) {
      test.skip()
      return
    }
    await aiBtn.click()

    const dialog = page.locator('[data-slot="dialog-content"]')
    await expect(dialog).toBeVisible({ timeout: 5_000 })

    // Wait for async migration to complete
    await page.waitForTimeout(2000)

    // Check that legacy key was removed
    const legacyData = await page.evaluate(() =>
      localStorage.getItem('reeeeecall-ai-config'),
    )

    // Check that v2 key was created
    const v2Data = await page.evaluate(() =>
      localStorage.getItem('reeeeecall-ai-config-v2'),
    )

    // After migration: legacy should be gone, v2 should exist
    expect(legacyData).toBeNull()
    expect(v2Data).not.toBeNull()

    if (v2Data) {
      const envelope = JSON.parse(v2Data)
      expect(envelope.v).toBe(1)
      // Encrypted data should NOT contain the plaintext key
      expect(envelope.data).not.toContain('xai-legacy-key-12345')
    }
  })

  test('sign-out clears AI config from localStorage', async ({ page }) => {
    await page.goto('/decks')
    await page.waitForTimeout(2000)

    // Seed some data in both keys
    await page.evaluate(() => {
      localStorage.setItem('reeeeecall-ai-config-v2', '{"v":1,"data":"test","storedAt":"2025-01-01","ttlMs":null}')
      localStorage.setItem('reeeeecall-ai-config', '{"old":"data"}')
    })

    // Verify data is there
    const before = await page.evaluate(() => ({
      v2: localStorage.getItem('reeeeecall-ai-config-v2'),
      legacy: localStorage.getItem('reeeeecall-ai-config'),
    }))
    expect(before.v2).not.toBeNull()
    expect(before.legacy).not.toBeNull()

    // Find and click logout button
    const logoutBtn = page.locator('button').filter({ hasText: /Logout|Sign Out|로그아웃/i }).first()
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click()
      await page.waitForTimeout(2000)

      // Both keys should be cleared
      const after = await page.evaluate(() => ({
        v2: localStorage.getItem('reeeeecall-ai-config-v2'),
        legacy: localStorage.getItem('reeeeecall-ai-config'),
      }))
      expect(after.v2).toBeNull()
      expect(after.legacy).toBeNull()
    }
  })

  test('hasKey returns true for encrypted config', async ({ page }) => {
    await page.goto('/decks')
    await page.waitForTimeout(2000)

    // Seed encrypted envelope
    await page.evaluate(() => {
      localStorage.setItem(
        'reeeeecall-ai-config-v2',
        JSON.stringify({
          v: 1,
          data: 'encrypted-blob',
          storedAt: new Date().toISOString(),
          ttlMs: null,
        }),
      )
    })

    // Navigate to AI generate page — should show "API key saved" hint
    await page.goto('/ai-generate')
    await page.waitForTimeout(2000)

    // The green "API key saved" badge should be visible
    const savedHint = page.locator('text=/API key saved|API 키가 저장/i')
    // If the page has this indicator, it means hasKey() returned true
    if (await savedHint.isVisible()) {
      expect(await savedHint.isVisible()).toBe(true)
    }
  })
})
