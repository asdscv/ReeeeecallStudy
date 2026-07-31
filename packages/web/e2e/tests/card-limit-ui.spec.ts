import { test, expect } from '../fixtures/test-helpers'

// Live browser check of the card-limit UI against a local Supabase stack. The test
// user is seeded AT the cap (5 owned / cap 5) by /tmp/cl_seed.sh, so the panels must
// render the real get_card_usage_detail breakdown + the "Limit reached" state.

test.use({ channel: 'chrome', video: 'off', trace: 'off', screenshot: 'off' })

test.describe('Card-limit UI (live local Supabase, user at cap 5/5)', () => {
  test('Dashboard surfaces the card-storage usage card in the at-cap state', async ({ page }) => {
    // fixture already logged in → lands on the dashboard
    await page.waitForLoadState('networkidle')
    const card = page.getByTestId('dashboard-card-usage')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card.getByText(/card storage|카드 저장/i)).toBeVisible()
    // available=0 → the "Limit reached" chip renders (proves the RPC value drove the UI)
    await expect(page.getByText(/limit reached|한도 도달/i).first()).toBeVisible()
  })

  test('Settings → Card storage shows the detailed usage panel breakdown', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    // expand the "Card storage" collapsible section
    await page.getByText(/card storage|카드 저장/i).first().click()
    // CardUsagePanel breakdown rows (from get_card_usage_detail)
    await expect(page.getByText(/my cards|내 카드/i).first()).toBeVisible()
    // big number = used_total (5)
    await expect(page.getByText('5', { exact: true }).first()).toBeVisible()
    // at-cap chip inside the panel
    await expect(page.getByText(/limit reached|한도 도달/i).first()).toBeVisible()
  })
})
