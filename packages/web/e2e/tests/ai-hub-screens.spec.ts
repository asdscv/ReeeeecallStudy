import { test, expect } from '../fixtures/test-helpers'

// Playwright's bundled chromium is not downloaded on this machine; the installed Chrome is.
// Same escape hatch as `card-limit-ui.spec.ts`. Video is off because this suite's output IS
// its screenshots — recording would only add a dependency on a bundled ffmpeg.
test.use({ channel: 'chrome', video: 'off' })

/**
 * Screenshot audit for the AI 학습 hub and every surface it gathers.
 *
 * Not an assertion suite — its output is the `e2e/screenshots/ai-hub/` folder, which is
 * read by eye (and by the design audit) after a change to the AI menu. Kept as a spec
 * rather than a script so it inherits the fresh-login fixture: Supabase allows one web
 * session at a time, so a standalone script would keep kicking whatever else is signed in.
 */

const SCHEMES = ['light', 'dark'] as const

// The hub plus every surface it gathers. The three feature paths are unchanged by this menu —
// only where they are reached from is new — so a shot of each is the regression baseline.
const SURFACES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'ai-hub', path: '/ai' },
  { name: 'learning-plan', path: '/learning' },
  { name: 'quiz', path: '/quiz' },
  { name: 'ai-generate', path: '/ai-generate' },
  { name: 'ai-generate-cards-only', path: '/ai-generate?mode=cards_only' },
  { name: 'decks', path: '/decks' },
]

test.describe('AI hub — screenshot audit', () => {
  for (const scheme of SCHEMES) {
    for (const { name, path } of SURFACES) {
      test(`${scheme}: ${name}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme })
        await page.goto(path)
        await page.waitForTimeout(2500)
        if (scheme === 'dark') {
          // `useTheme` resolves the profile's stored theme LAST and wins over both localStorage
          // and prefers-color-scheme, so the test account's 'light' would come back after login
          // and every "dark" shot would be a duplicate of its light twin — which is exactly what
          // happened the first time this ran. The class is what the CSS variables key off, so
          // setting it directly is the honest way to photograph the dark palette without
          // writing a theme change into a real account.
          await page.evaluate(() => document.documentElement.classList.add('dark'))
          await page.waitForTimeout(400)
        }
        await page.screenshot({
          path: `e2e/screenshots/ai-hub/${scheme}-${name}.png`,
          fullPage: true,
        })
      })
    }
  }

  // The menu itself only exists once opened, so it needs its own shot.
  test('nav: study group expanded', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: /학습|Study/ }).first().click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'e2e/screenshots/ai-hub/nav-study-open.png' })
  })
})

/**
 * The half of the request that has no menu of its own: deck creation and card creation each
 * get a way into the AI 학습 menu, with the mode already chosen. Shot from inside the modal,
 * because the whole question is whether the action reads as optional next to Save.
 */
test.describe('AI hub — creation entry points', () => {
  test('new-deck modal offers AI로 만들기', async ({ page }) => {
    await page.goto('/decks')
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: /New Deck|새 덱/ }).first().click()
    await page.waitForTimeout(800)
    const aiGenerate = page.getByRole('button', { name: /AI Generate|AI로 만들기/ }).last()
    // The modal scrolls; the AI action sits under Save, which is the point of it.
    await aiGenerate.scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'e2e/screenshots/ai-hub/entry-deck-create.png' })

    await aiGenerate.click()
    await page.waitForURL(/\/ai-generate/)
    await page.waitForTimeout(2000)
    expect(new URL(page.url()).searchParams.get('mode')).toBe('full')
    await page.screenshot({ path: 'e2e/screenshots/ai-hub/entry-deck-create-landed.png', fullPage: true })
  })

  test('new-card modal offers AI 카드 생성, carrying the deck', async ({ page }) => {
    await page.goto('/decks')
    await page.waitForTimeout(2500)

    // Deck cards are clickable divs, not links, and a read-only deck has no "+ Card" at all —
    // it cannot receive cards, so it must not offer to generate them either. Walk the list
    // until an editable deck turns up rather than assuming the first one is ours.
    const headings = page.getByRole('heading', { level: 3 })
    const count = await headings.count()
    let opened = false
    for (let i = 0; i < Math.min(count, 6); i++) {
      await page.goto('/decks')
      await page.waitForTimeout(2000)
      await page.getByRole('heading', { level: 3 }).nth(i).click()
      await page.waitForTimeout(2500)
      const addCard = page.getByRole('button', { name: /\+ Card|카드 추가/ })
      if (await addCard.count()) {
        await addCard.first().click()
        opened = true
        break
      }
    }
    expect(opened, 'no editable deck found to add a card to').toBe(true)

    await page.waitForTimeout(1000)
    const aiCards = page.getByRole('button', { name: /AI Cards|AI 카드/ }).last()
    await aiCards.scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'e2e/screenshots/ai-hub/entry-card-create.png' })

    await aiCards.click()
    await page.waitForURL(/\/ai-generate/)
    await page.waitForTimeout(2000)
    const params = new URL(page.url()).searchParams
    expect(params.get('mode')).toBe('cards_only')
    expect(params.get('deckId')).toBeTruthy()
    await page.screenshot({ path: 'e2e/screenshots/ai-hub/entry-card-create-landed.png', fullPage: true })
  })
})
