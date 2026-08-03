import { test } from '../fixtures/test-helpers'
test('what the browser sends and gets back', async ({ page }) => {
  page.on('request', (r) => {
    if (r.url().includes('get_goal_knowledge')) console.log('[req]', r.postData())
  })
  page.on('response', async (r) => {
    if (r.url().includes('get_goal_knowledge')) console.log('[res]', r.status(), (await r.text().catch(() => '')).slice(0, 200))
  })
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(3000)
})
