/**
 * Capture screenshots for ALL guide sections (PC + Mobile).
 * Run: npx playwright test capture-all-guide-screenshots --project=chromium
 */
import { test } from '@playwright/test'

const IMG = 'public/images/guide'

async function pcAndMobile(
  browser: any,
  name: string,
  fn: (page: any) => Promise<void>,
) {
  // PC
  const pcCtx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: 'playwright/.auth/user.json',
  })
  const pcPage = await pcCtx.newPage()
  await fn(pcPage)
  await pcPage.waitForTimeout(1000)
  await pcPage.screenshot({ path: `${IMG}/${name}-pc.png` })
  await pcCtx.close()

  // Mobile
  const mCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: 'playwright/.auth/user.json',
    isMobile: true,
  })
  const mPage = await mCtx.newPage()
  await fn(mPage)
  await mPage.waitForTimeout(1000)
  await mPage.screenshot({ path: `${IMG}/${name}-mobile.png` })
  await mCtx.close()
}

test.describe('Capture All Guide Screenshots', () => {
  test.setTimeout(120_000)

  // ── Getting Started ──
  test('getting-started: dashboard', async ({ browser }) => {
    await pcAndMobile(browser, 'getting-started/dashboard', async (page) => {
      await page.goto('/dashboard')
      await page.waitForTimeout(2000)
    })
  })

  test('getting-started: navigation', async ({ browser }) => {
    await pcAndMobile(browser, 'getting-started/navigation', async (page) => {
      await page.goto('/dashboard')
      await page.waitForTimeout(1500)
      // Open Study dropdown on desktop, hamburger on mobile
      const studyBtn = page.locator('button').filter({ hasText: /Study|학습/i }).first()
      if (await studyBtn.isVisible()) await studyBtn.click()
      await page.waitForTimeout(500)
    })
  })

  // ── Decks ──
  test('decks: list', async ({ browser }) => {
    await pcAndMobile(browser, 'decks/list', async (page) => {
      await page.goto('/decks')
      await page.waitForTimeout(2000)
    })
  })

  test('decks: detail', async ({ browser }) => {
    await pcAndMobile(browser, 'decks/detail', async (page) => {
      await page.goto('/decks')
      await page.waitForTimeout(2000)
      const firstDeck = page.locator('a[href*="/decks/"]').first()
      if (await firstDeck.isVisible()) {
        await firstDeck.click()
        await page.waitForTimeout(2000)
      }
    })
  })

  // ── Cards (shown inside deck detail) ──
  test('cards: table', async ({ browser }) => {
    await pcAndMobile(browser, 'cards/table', async (page) => {
      await page.goto('/decks')
      await page.waitForTimeout(1500)
      const firstDeck = page.locator('a[href*="/decks/"]').first()
      if (await firstDeck.isVisible()) {
        await firstDeck.click()
        await page.waitForTimeout(2000)
      }
    })
  })

  // ── Templates ──
  test('templates: list', async ({ browser }) => {
    await pcAndMobile(browser, 'templates/list', async (page) => {
      await page.goto('/templates')
      await page.waitForTimeout(2000)
    })
  })

  test('templates: edit', async ({ browser }) => {
    await pcAndMobile(browser, 'templates/edit', async (page) => {
      await page.goto('/templates')
      await page.waitForTimeout(1500)
      const editBtn = page.locator('button').filter({ hasText: /Edit|수정/i }).first()
      if (await editBtn.isVisible()) {
        await editBtn.click()
        await page.waitForTimeout(2000)
      }
    })
  })

  // ── Study ──
  test('study: quick-study', async ({ browser }) => {
    await pcAndMobile(browser, 'study/quick-study', async (page) => {
      await page.goto('/quick-study')
      await page.waitForTimeout(2000)
    })
  })

  test('study: setup', async ({ browser }) => {
    await pcAndMobile(browser, 'study/setup', async (page) => {
      await page.goto('/decks')
      await page.waitForTimeout(1500)
      // Click "Study" on first deck
      const studyBtn = page.locator('a, button').filter({ hasText: /Study|학습/i }).first()
      if (await studyBtn.isVisible()) {
        await studyBtn.click()
        await page.waitForTimeout(2000)
      }
    })
  })

  // ── Import/Export ──
  test('import-export: buttons', async ({ browser }) => {
    await pcAndMobile(browser, 'import-export/buttons', async (page) => {
      await page.goto('/decks')
      await page.waitForTimeout(1500)
      const firstDeck = page.locator('a[href*="/decks/"]').first()
      if (await firstDeck.isVisible()) {
        await firstDeck.click()
        await page.waitForTimeout(2000)
      }
    })
  })

  // ── Sharing ──
  test('sharing: share-page', async ({ browser }) => {
    await pcAndMobile(browser, 'sharing/share-page', async (page) => {
      await page.goto('/decks')
      await page.waitForTimeout(1500)
      const firstDeck = page.locator('a[href*="/decks/"]').first()
      if (await firstDeck.isVisible()) {
        await firstDeck.click()
        await page.waitForTimeout(1500)
        const shareBtn = page.locator('a, button').filter({ hasText: /Share|공유/i }).first()
        if (await shareBtn.isVisible()) {
          await shareBtn.click()
          await page.waitForTimeout(2000)
        }
      }
    })
  })

  // ── Marketplace ──
  test('marketplace: browse', async ({ browser }) => {
    await pcAndMobile(browser, 'marketplace/browse', async (page) => {
      await page.goto('/marketplace')
      await page.waitForTimeout(2000)
    })
  })

  // ── History ──
  test('history: overview', async ({ browser }) => {
    await pcAndMobile(browser, 'history/overview', async (page) => {
      await page.goto('/history')
      await page.waitForTimeout(2000)
    })
  })

  // ── Settings ──
  test('settings: page', async ({ browser }) => {
    await pcAndMobile(browser, 'settings/page', async (page) => {
      await page.goto('/settings')
      await page.waitForTimeout(2000)
    })
  })
})
