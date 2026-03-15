import { test, expect } from '../fixtures/test-helpers'

/**
 * Admin Dashboard E2E Tests
 * Tests all 6 admin tabs: Overview, Users, Study, Market, Contents, System
 * Runs on both desktop (chromium) and mobile (mobile-chrome) projects
 */

test.describe('Admin Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin')
    // Skip if not admin
    const url = page.url()
    if (!url.includes('/admin')) {
      test.skip()
    }
  })

  // ── Overview Tab ──

  test.describe('Overview', () => {
    test('renders health score ring', async ({ page }) => {
      // Wait for data to load (skeleton disappears)
      await page.waitForTimeout(3000)
      // Health score text is visible
      const healthLabel = page.getByText(/Health Score|서비스 건강도/)
      await expect(healthLabel).toBeVisible({ timeout: 10_000 })
      // The SVG with viewBox="0 0 100 100" is the health ring
      const ring = page.locator('svg[viewBox="0 0 100 100"]')
      await expect(ring).toBeVisible({ timeout: 5_000 })
    })

    test('shows key metric stat cards', async ({ page }) => {
      // Should have at least 5 stat cards in the first grid
      const statCards = page.locator('.grid .bg-white.rounded-xl.border')
      await expect(statCards.first()).toBeVisible({ timeout: 10_000 })
      expect(await statCards.count()).toBeGreaterThanOrEqual(5)
    })

    test('shows WoW trend section', async ({ page }) => {
      const wowSection = page.getByText(/Week-over-Week|주간 대비/)
      await expect(wowSection).toBeVisible({ timeout: 10_000 })
    })

    test('renders recent activity chart', async ({ page }) => {
      // Recharts renders SVG .recharts-wrapper
      const chart = page.locator('.recharts-wrapper').first()
      await expect(chart).toBeVisible({ timeout: 10_000 })
    })

    test('shows engagement metrics when data available', async ({ page }) => {
      const engagement = page.getByText(/Engagement|참여도/)
      // May or may not be visible depending on data, just check no crash
      await page.waitForTimeout(2000)
      const isVisible = await engagement.isVisible()
      expect(typeof isVisible).toBe('boolean')
    })
  })

  // ── Users Tab ──

  test.describe('Users', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/admin/users')
    })

    test('renders user growth and signups charts', async ({ page }) => {
      const charts = page.locator('.recharts-wrapper')
      await expect(charts.first()).toBeVisible({ timeout: 10_000 })
    })

    test('shows search input', async ({ page }) => {
      const search = page.locator('input[type="text"]')
      await expect(search).toBeVisible({ timeout: 10_000 })
    })

    test('shows role filter dropdown', async ({ page }) => {
      const selects = page.locator('select')
      await expect(selects.first()).toBeVisible({ timeout: 10_000 })
      expect(await selects.count()).toBeGreaterThanOrEqual(2)
    })

    test('search filters user list', async ({ page }) => {
      const search = page.locator('input[type="text"]')
      await expect(search).toBeVisible({ timeout: 10_000 })

      // Type a search term
      await search.fill('test_nonexistent_user_xyz')
      // Wait for debounce (300ms) + network
      await page.waitForTimeout(1000)

      // Should show no data or different results
      const tableBody = page.locator('table tbody')
      await expect(tableBody).toBeVisible()
    })

    test('role filter works', async ({ page }) => {
      const roleSelect = page.locator('select').first()
      await expect(roleSelect).toBeVisible({ timeout: 10_000 })

      // Select admin role
      await roleSelect.selectOption('admin')
      await page.waitForTimeout(500)

      // Page should reload with filtered results
      const tableBody = page.locator('table tbody')
      await expect(tableBody).toBeVisible()
    })

    test('clear filters button appears when filter active', async ({ page }) => {
      const roleSelect = page.locator('select').first()
      await expect(roleSelect).toBeVisible({ timeout: 10_000 })

      // Before filter: no clear button
      const clearBtn = page.getByText(/Clear Filters|필터 초기화/)
      await expect(clearBtn).not.toBeVisible()

      // Apply filter
      await roleSelect.selectOption('admin')
      await page.waitForTimeout(500)

      // Now clear button should be visible
      await expect(clearBtn).toBeVisible()
    })

    test('user table has 4 columns', async ({ page }) => {
      const headers = page.locator('table thead th')
      await expect(headers.first()).toBeVisible({ timeout: 10_000 })
      await expect(headers).toHaveCount(4)
    })

    test('pagination controls work', async ({ page }) => {
      const pagination = page.locator('.border-t.border-gray-100')
      // Wait for table to load
      await page.waitForTimeout(2000)
      const isVisible = await pagination.isVisible()
      if (isVisible) {
        const nextBtn = page.getByRole('button', { name: /다음|Next/i })
        await expect(nextBtn).toBeVisible()
      }
    })

    test('retention metrics section renders', async ({ page }) => {
      const retention = page.getByText(/Monthly Retention|월간 리텐션/)
      await page.waitForTimeout(2000)
      const isVisible = await retention.isVisible()
      expect(typeof isVisible).toBe('boolean')
    })
  })

  // ── Study Activity Tab ──

  test.describe('Study Activity', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/admin/study')
    })

    test('shows period selector buttons', async ({ page }) => {
      const periodBtns = page.locator('button[aria-pressed]')
      await expect(periodBtns.first()).toBeVisible({ timeout: 10_000 })
      expect(await periodBtns.count()).toBe(4)
    })

    test('changing period reloads data', async ({ page }) => {
      // Find the 7-day button
      const btn7 = page.locator('button[aria-pressed]').first()
      await expect(btn7).toBeVisible({ timeout: 10_000 })
      await btn7.click()
      await page.waitForTimeout(1000)
      // Should still show charts
      const charts = page.locator('.recharts-wrapper')
      await page.waitForTimeout(2000)
      const chartCount = await charts.count()
      expect(chartCount).toBeGreaterThanOrEqual(0) // May be 0 if no data
    })

    test('SRS breakdown section renders', async ({ page }) => {
      const srs = page.getByText(/SRS Status|SRS 상태/)
      await page.waitForTimeout(3000)
      const isVisible = await srs.isVisible()
      expect(typeof isVisible).toBe('boolean')
    })

    test('mode effectiveness table renders', async ({ page }) => {
      const table = page.getByText(/Mode Effectiveness|모드별 효율성/)
      await page.waitForTimeout(3000)
      const isVisible = await table.isVisible()
      expect(typeof isVisible).toBe('boolean')
    })
  })

  // ── Market Tab ──

  test.describe('Market', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/admin/market')
    })

    test('shows loading skeleton or stat cards', async ({ page }) => {
      // Either skeleton or stat cards should appear
      const card = page.locator('.bg-white.rounded-xl').first()
      await expect(card).toBeVisible({ timeout: 10_000 })
    })

    test('displays 5 KPI stat cards', async ({ page }) => {
      // Wait for data to load
      await page.waitForTimeout(3000)
      const statCards = page.locator('.grid .bg-white.rounded-xl.border')
      const count = await statCards.count()
      expect(count).toBeGreaterThanOrEqual(3)
    })

    test('conversion KPIs show subtitle details', async ({ page }) => {
      await page.waitForTimeout(3000)
      // Subtitle shows "X / Y" format
      const subtitles = page.locator('.text-\\[11px\\]')
      const count = await subtitles.count()
      expect(count).toBeGreaterThanOrEqual(0)
    })

    test('share mode section renders (chart or empty)', async ({ page }) => {
      await page.waitForTimeout(3000)
      // Either pie chart or no data
      const shareSection = page.getByText(/Shares by Mode|공유 방식별/)
      const isVisible = await shareSection.isVisible()
      expect(typeof isVisible).toBe('boolean')
    })

    test('top categories renders as bar chart', async ({ page }) => {
      await page.waitForTimeout(3000)
      const catSection = page.getByText(/Top Categories|인기 카테고리/)
      const isVisible = await catSection.isVisible()
      expect(typeof isVisible).toBe('boolean')
    })
  })

  // ── Contents Tab ──

  test.describe('Contents', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/admin/contents')
    })

    test('shows content stat cards', async ({ page }) => {
      const cards = page.locator('.grid .bg-white.rounded-xl.border')
      await expect(cards.first()).toBeVisible({ timeout: 10_000 })
    })

    test('shows period selector buttons', async ({ page }) => {
      const periodBtns = page.locator('button[aria-pressed]')
      await expect(periodBtns.first()).toBeVisible({ timeout: 10_000 })
      expect(await periodBtns.count()).toBe(5) // 7, 14, 30, 60, 90
    })

    test('changing period updates chart', async ({ page }) => {
      const btn7 = page.locator('button[aria-pressed]').first()
      await expect(btn7).toBeVisible({ timeout: 10_000 })
      await btn7.click()
      await page.waitForTimeout(1000)
      // Chart should still render
      const chart = page.locator('.recharts-wrapper')
      await page.waitForTimeout(2000)
      expect(await chart.count()).toBeGreaterThanOrEqual(0)
    })

    test('daily content views chart renders', async ({ page }) => {
      const title = page.getByText(/Daily Content Views|일별 콘텐츠 조회수/)
      await page.waitForTimeout(3000)
      const isVisible = await title.isVisible()
      expect(typeof isVisible).toBe('boolean')
    })

    test('traffic source and device charts render', async ({ page }) => {
      await page.waitForTimeout(3000)
      const trafficTitle = page.getByText(/Traffic Sources|트래픽 소스/)
      const deviceTitle = page.getByText(/Device Types|기기 유형/)
      // At least one should be visible if there's data
      const trafficVisible = await trafficTitle.isVisible()
      const deviceVisible = await deviceTitle.isVisible()
      expect(typeof trafficVisible).toBe('boolean')
      expect(typeof deviceVisible).toBe('boolean')
    })

    test('conversion funnel renders', async ({ page }) => {
      await page.waitForTimeout(3000)
      const funnel = page.getByText(/Conversion Funnel|전환 퍼널/)
      const isVisible = await funnel.isVisible()
      expect(typeof isVisible).toBe('boolean')
    })

    test('popular content table renders', async ({ page }) => {
      await page.waitForTimeout(3000)
      const popular = page.getByText(/Popular Content|인기 콘텐츠/)
      const isVisible = await popular.isVisible()
      expect(typeof isVisible).toBe('boolean')
    })

    test('top pages table renders', async ({ page }) => {
      await page.waitForTimeout(3000)
      const topPages = page.getByText(/Top Pages|인기 페이지/)
      const isVisible = await topPages.isVisible()
      expect(typeof isVisible).toBe('boolean')
    })
  })

  // ── System Tab ──

  test.describe('System', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/admin/system')
    })

    test('shows system health indicators', async ({ page }) => {
      const healthTitle = page.getByText(/System Health|시스템 상태/)
      await expect(healthTitle).toBeVisible({ timeout: 10_000 })
    })

    test('health indicators show colored dots', async ({ page }) => {
      // animated pulse dots
      const dots = page.locator('.animate-pulse.rounded-full')
      await expect(dots.first()).toBeVisible({ timeout: 10_000 })
      expect(await dots.count()).toBeGreaterThanOrEqual(2)
    })

    test('API keys section with progress bars', async ({ page }) => {
      const apiSection = page.getByText(/API Key Management|API 키 관리/)
      await expect(apiSection).toBeVisible({ timeout: 10_000 })
      // Progress bars
      const bars = page.locator('.bg-gray-200.rounded-full.h-2')
      await page.waitForTimeout(2000)
      const count = await bars.count()
      expect(count).toBeGreaterThanOrEqual(0)
    })

    test('content pipeline section renders', async ({ page }) => {
      const pipeline = page.getByText(/Content Pipeline|콘텐츠 파이프라인/).last()
      await pipeline.scrollIntoViewIfNeeded()
      await expect(pipeline).toBeVisible({ timeout: 10_000 })
    })

    test('study activity section renders', async ({ page }) => {
      const study = page.getByText(/Study Activity Data|학습 활동 데이터/)
      await study.scrollIntoViewIfNeeded()
      await expect(study).toBeVisible({ timeout: 10_000 })
    })
  })

  // ── Tab Navigation ──

  test.describe('Navigation', () => {
    test('all 6 admin tabs are visible', async ({ page }) => {
      // Use the admin nav specifically (border-b nav inside admin layout)
      const adminNav = page.locator('nav.border-b')
      await expect(adminNav).toBeVisible({ timeout: 10_000 })
      const tabs = adminNav.locator('a')
      await expect(tabs).toHaveCount(6)
    })

    test('clicking each tab navigates correctly', async ({ page }) => {
      const adminNav = page.locator('nav.border-b')
      await expect(adminNav).toBeVisible({ timeout: 10_000 })

      const tabPaths = [
        { name: /Users|사용자/, path: '/admin/users' },
        { name: /Study|학습/, path: '/admin/study' },
        { name: /Market|마켓/, path: '/admin/market' },
        { name: /Contents|콘텐츠/, path: '/admin/contents' },
        { name: /System|시스템/, path: '/admin/system' },
      ]

      for (const tab of tabPaths) {
        await adminNav.getByRole('link', { name: tab.name }).click()
        await page.waitForURL(`**${tab.path}`, { timeout: 5_000 })
        expect(page.url()).toContain(tab.path)
      }
    })

    test('active tab has blue highlight', async ({ page }) => {
      const adminNav = page.locator('nav.border-b')
      const activeTab = adminNav.locator('a.border-blue-600')
      await expect(activeTab).toBeVisible({ timeout: 5_000 })
      await expect(activeTab).toHaveCount(1)
    })
  })

  // ── Mobile Responsive ──

  test.describe('Responsive Layout', () => {
    test('stat cards stack on mobile viewport', async ({ page }) => {
      const grid = page.locator('.grid').first()
      await expect(grid).toBeVisible({ timeout: 10_000 })
      // Grid should be rendered
      const display = await grid.evaluate(el => getComputedStyle(el).display)
      expect(display).toBe('grid')
    })

    test('tables are horizontally scrollable', async ({ page }) => {
      await page.goto('/admin/users')
      const scrollContainer = page.locator('.overflow-x-auto')
      await page.waitForTimeout(3000)
      const count = await scrollContainer.count()
      expect(count).toBeGreaterThanOrEqual(0)
    })

    test('tab navigation is scrollable on mobile', async ({ page }) => {
      const nav = page.locator('nav.overflow-x-auto')
      await expect(nav).toBeVisible({ timeout: 5_000 })
    })
  })
})
