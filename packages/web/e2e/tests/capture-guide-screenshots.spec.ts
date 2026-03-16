/**
 * Capture AI Generate feature screenshots for the user guide.
 * Run: npx playwright test capture-guide-screenshots --project=chromium
 */
import { test } from '@playwright/test'

const GROK_API_KEY = process.env.E2E_GROK_API_KEY ?? ''
const OUTPUT_DIR = 'public/images/guide/ai-generate'

test.describe('Capture AI Generate Screenshots', () => {
  test('PC screenshots', async ({ browser }) => {
    test.setTimeout(180_000)
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      storageState: 'playwright/.auth/user.json',
    })
    const page = await context.newPage()

    await page.goto('/ai-generate')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${OUTPUT_DIR}/pc-01-page.png` })

    await page.locator('select').first().selectOption('xai')
    await page.locator('input[type="password"]').fill(GROK_API_KEY)
    await page.locator('fieldset').first().locator('select').nth(1).selectOption('grok-3-mini')
    await page.locator('input[type="text"]').first().fill('JLPT N5 일본어 단어')
    await page.locator('input[type="range"]').fill('10')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUTPUT_DIR}/pc-02-config.png` })

    await page.locator('button[type="submit"]').click()
    await page.waitForTimeout(3000)
    await page.screenshot({ path: `${OUTPUT_DIR}/pc-03-generating.png` })

    await page.locator('button').filter({ hasText: /Regenerate|재생성/i }).waitFor({ timeout: 90_000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUTPUT_DIR}/pc-04-review-template.png` })

    await page.locator('button').filter({ hasText: /Next|다음/i }).click()
    await page.locator('button.rounded-full[style*="background"]').first().waitFor({ timeout: 90_000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUTPUT_DIR}/pc-05-review-deck.png` })

    await page.locator('button').filter({ hasText: /Next|다음/i }).click()
    await page.locator('table').waitFor({ timeout: 90_000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUTPUT_DIR}/pc-06-review-cards.png` })

    await page.locator('button').filter({ hasText: /Save|저장/i }).last().click()
    await page.locator('h3').filter({ hasText: /Complete|완료/i }).waitFor({ timeout: 30_000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUTPUT_DIR}/pc-07-done.png` })

    await context.close()
  })

  test('Mobile screenshots', async ({ browser }) => {
    test.setTimeout(180_000)
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: 'playwright/.auth/user.json',
      isMobile: true,
    })
    const page = await context.newPage()

    await page.goto('/ai-generate')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${OUTPUT_DIR}/mobile-01-page.png` })

    await page.locator('select').first().selectOption('xai')
    await page.locator('input[type="password"]').fill(GROK_API_KEY)
    await page.locator('fieldset').first().locator('select').nth(1).selectOption('grok-3-mini')
    await page.locator('input[type="text"]').first().fill('JLPT N5 일본어 단어')
    await page.locator('input[type="range"]').fill('10')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUTPUT_DIR}/mobile-02-config.png`, fullPage: true })

    await page.locator('button[type="submit"]').click()
    await page.waitForTimeout(3000)
    await page.screenshot({ path: `${OUTPUT_DIR}/mobile-03-generating.png` })

    await page.locator('button').filter({ hasText: /Regenerate|재생성/i }).waitFor({ timeout: 90_000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUTPUT_DIR}/mobile-04-review-template.png`, fullPage: true })

    await page.locator('button').filter({ hasText: /Next|다음/i }).click()
    await page.locator('button.rounded-full[style*="background"]').first().waitFor({ timeout: 90_000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUTPUT_DIR}/mobile-05-review-deck.png` })

    await page.locator('button').filter({ hasText: /Next|다음/i }).click()
    await page.locator('table').waitFor({ timeout: 90_000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUTPUT_DIR}/mobile-06-review-cards.png` })

    await page.locator('button').filter({ hasText: /Save|저장/i }).last().click()
    await page.locator('h3').filter({ hasText: /Complete|완료/i }).waitFor({ timeout: 30_000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUTPUT_DIR}/mobile-07-done.png` })

    await context.close()
  })
})
