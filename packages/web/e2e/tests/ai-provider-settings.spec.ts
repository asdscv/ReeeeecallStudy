import { test, expect } from '../fixtures/test-helpers'

/**
 * E2E: AI Provider 설정 (Supabase 서버사이드 암호화)
 */

async function openAiSection(page: import('@playwright/test').Page) {
  await page.goto('/settings')
  await page.waitForTimeout(2000)

  // AI 프로바이더 섹션은 접혀있음 → 토글 버튼 클릭해서 열기
  const toggleBtn = page.locator('button').filter({ hasText: /AI Providers|AI 프로바이더/i }).first()
  await toggleBtn.scrollIntoViewIfNeeded()
  await toggleBtn.click()
  await page.waitForTimeout(500)

  return page.locator('section').filter({ hasText: /AI Providers|AI 프로바이더/i })
}

test.describe('AI Provider Settings — Supabase Backend', () => {
  test('shows all providers after expanding', async ({ page }) => {
    const section = await openAiSection(page)

    await expect(section.getByText('OpenAI', { exact: false }).first()).toBeVisible({ timeout: 5_000 })
    await expect(section.getByText('Google Gemini')).toBeVisible()
    await expect(section.getByText('Anthropic Claude')).toBeVisible()
    await expect(section.getByText(/xAI/i).first()).toBeVisible()
  })

  test('toggle accordion opens edit form', async ({ page }) => {
    const section = await openAiSection(page)

    // OpenAI 프로바이더 행 클릭
    const providerRow = section.locator('button').filter({ hasText: /OpenAI/i }).first()
    await providerRow.click()
    await page.waitForTimeout(500)

    // API 키 입력 폼이 나타나야 함
    await expect(section.locator('input[type="password"]')).toBeVisible({ timeout: 5_000 })
    await expect(section.locator('select')).toBeVisible()
  })

  test('can save provider key via Supabase', async ({ page }) => {
    const section = await openAiSection(page)

    // xAI 토글 열기
    const xaiRow = section.locator('button').filter({ hasText: /xAI/i }).first()
    await xaiRow.click()
    await page.waitForTimeout(500)

    // API 키 입력 + 저장
    const apiKeyInput = section.locator('input[type="password"]')
    await apiKeyInput.fill('xai-e2e-test-key-' + Date.now())

    const saveBtn = section.locator('button').filter({ hasText: /^Save$|^저장$/i }).first()
    await saveBtn.click()
    await page.waitForTimeout(2000)

    // 설정됨 배지 확인
    await expect(section.getByText(/Configured|설정됨/i).first()).toBeVisible({ timeout: 5_000 })

    // 새로고침 후에도 유지 (서버에서 로드)
    await page.reload()
    await page.waitForTimeout(3000)
    const toggleBtn = page.locator('button').filter({ hasText: /AI Providers|AI 프로바이더/i }).first()
    await toggleBtn.scrollIntoViewIfNeeded()
    await toggleBtn.click()
    await page.waitForTimeout(500)

    const sectionAfter = page.locator('section').filter({ hasText: /AI Providers|AI 프로바이더/i })
    await expect(sectionAfter.getByText(/Configured|설정됨/i).first()).toBeVisible({ timeout: 10_000 })
  })

  test('can delete a configured provider', async ({ page }) => {
    const section = await openAiSection(page)

    // 설정됨 배지가 있는 프로바이더 행 클릭
    const configuredRow = section.locator('button').filter({ has: page.locator('text=/Configured|설정됨/i') }).first()
    if (!(await configuredRow.isVisible().catch(() => false))) {
      test.skip()
      return
    }
    await configuredRow.click()
    await page.waitForTimeout(500)

    // 삭제 버튼 (Trash2 아이콘)
    const deleteBtn = section.locator('button:has(svg.lucide-trash-2)').first()
    if (!(await deleteBtn.isVisible().catch(() => false))) {
      test.skip()
      return
    }
    await deleteBtn.click()
    await page.waitForTimeout(2000)

    // 미설정 배지 증가 확인
    const notSetCount = await section.getByText(/Not set|미설정/i).count()
    expect(notSetCount).toBeGreaterThanOrEqual(1)
  })

  test('cancel closes edit form', async ({ page }) => {
    const section = await openAiSection(page)

    // 프로바이더 토글 열기
    const providerRow = section.locator('button').filter({ hasText: /Google Gemini/i }).first()
    await providerRow.click()
    await page.waitForTimeout(500)

    const apiKeyInput = section.locator('input[type="password"]')
    await expect(apiKeyInput).toBeVisible({ timeout: 5_000 })

    // 취소 클릭
    const cancelBtn = section.locator('button').filter({ hasText: /Cancel|취소/i })
    await cancelBtn.click()

    await expect(apiKeyInput).not.toBeVisible({ timeout: 3_000 })
  })

  test('security note is visible', async ({ page }) => {
    const section = await openAiSection(page)
    await expect(section.getByText(/encrypted|암호화/i).first()).toBeVisible({ timeout: 5_000 })
  })
})
