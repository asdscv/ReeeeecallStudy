import { test, expect } from '../fixtures/test-helpers'

// Smoke test for the Quick Create (간편 만들기) flow: name a deck, pick a card
// shape by field count (default = 1 front / 1 back), type a card, create — and
// land on the new deck with the card visible. The matching template is
// found-or-created on submit. Uses fresh-login-per-test (Supabase single-session).
// Creates real data under the E2E test account; each created deck is deleted in
// afterEach via the Supabase REST API (cards cascade-delete with the deck).

const MARKER = 'QCSMOKE'

test.describe('Quick Create flow', () => {
  let restUrl = ''
  let restHeaders: Record<string, string> = {}
  let createdDeckId = ''

  test.beforeEach(async ({ page }) => {
    // Capture the Supabase REST base URL + auth headers from a live request so
    // afterEach can clean up the deck this test creates.
    await page.route('**/rest/v1/**', async (route) => {
      const h = route.request().headers()
      if (h['apikey'] && !restUrl) {
        const u = new URL(route.request().url())
        restUrl = `${u.protocol}//${u.host}`
        restHeaders = {
          apikey: h['apikey'],
          authorization: h['authorization'] ?? '',
          'content-type': 'application/json',
        }
      }
      await route.continue()
    })
  })

  test.afterEach(async ({ page }) => {
    if (createdDeckId && restUrl && restHeaders.authorization) {
      await page
        .evaluate(
          async ({ url, headers, deckId }) => {
            // cards have ON DELETE CASCADE on deck_id, so deleting the deck row
            // removes its cards too.
            await fetch(`${url}/rest/v1/decks?id=eq.${deckId}`, { method: 'DELETE', headers })
          },
          { url: restUrl, headers: restHeaders, deckId: createdDeckId },
        )
        .catch(() => {})
      createdDeckId = ''
    }
  })

  test('creates a deck with a card in one step and opens it', async ({ page }) => {
    const deckName = `${MARKER}-${Date.now()}`
    const frontText = `${MARKER}-front-${Date.now()}`

    await page.goto('/decks')

    // Open the Quick Create modal.
    await page.getByTestId('quick-create-button').click()

    // Deck name + card fields render immediately (the default 1·1 shape is
    // preselected; no server round-trip to load a template first).
    await page.getByTestId('qc-deck-name').fill(deckName)
    await expect(page.getByTestId('qc-card-0-0')).toBeVisible({ timeout: 15_000 })

    // Fill the first two fields of the first card row (works for any preset).
    await page.getByTestId('qc-card-0-0').fill(frontText)
    const back = page.getByTestId('qc-card-0-1')
    if (await back.isVisible().catch(() => false)) {
      await back.fill(`${MARKER}-back`)
    }

    // Create → should navigate to the new deck's detail page.
    await page.getByTestId('qc-submit').click()
    await page.waitForURL(/\/decks\/[0-9a-fA-F-]{8,}/, { timeout: 20_000 })
    createdDeckId = (page.url().match(/\/decks\/([0-9a-fA-F-]{8,})/) ?? [])[1] ?? ''

    // The card we typed should be visible on the deck detail.
    await expect(page.getByText(frontText).first()).toBeVisible({ timeout: 15_000 })
  })

  test('AI generate page renders translated (namespace loads)', async ({ page }) => {
    await page.goto('/ai-generate')
    await expect(page).toHaveURL(/\/ai-generate/)
    // If the ai-generate i18n namespace failed to load, t() would render raw
    // dot-path keys. Assert none of those leak into the page.
    const body = page.locator('body')
    await expect(body).toBeVisible()
    await expect(body).not.toContainText('ai-generate:')
    await expect(body).not.toContainText('page.title')
    await expect(body).not.toContainText('config.cardCountHint')
  })

  test('hardened RPCs reject cross-user abuse (copy_deck_for_user / accept_invite)', async ({ page }) => {
    await page.goto('/decks')
    // Wait until the REST auth headers are captured from a live request.
    await expect
      .poll(() => (restUrl !== '' && !!restHeaders.authorization), { timeout: 15_000 })
      .toBe(true)

    const res = await page.evaluate(
      async ({ url, headers }) => {
        const call = async (fn: string, body: unknown) => {
          const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          })
          return { status: r.status, text: await r.text() }
        }
        // Attempt to copy an arbitrary deck INTO someone else's account.
        const copy = await call('copy_deck_for_user', {
          p_source_deck_id: crypto.randomUUID(),
          p_recipient_id: crypto.randomUUID(), // != caller → must be rejected
          p_is_readonly: false,
          p_share_mode: 'copy',
        })
        // Attempt to accept a bogus invite code.
        const accept = await call('accept_invite', { p_code: `bogus-${crypto.randomUUID()}` })
        return { copy, accept }
      },
      { url: restUrl, headers: restHeaders },
    )

    // Migration 094: copy_deck_for_user now rejects a recipient != caller.
    expect(res.copy.status).toBeGreaterThanOrEqual(400)
    expect(res.copy.text).toMatch(/Unauthorized recipient|Access denied/i)
    // accept_invite is reachable by an authenticated user and guards bad codes.
    expect(res.accept.status).toBeGreaterThanOrEqual(400)
    expect(res.accept.text).toMatch(/invalidOrExpired/i)
  })
})
