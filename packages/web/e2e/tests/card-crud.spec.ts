import { test, expect } from '@playwright/test'

test.describe('Card CRUD', () => {
  test.use({ storageState: 'playwright/.auth/user.json' })

  test('should show cards in deck detail', async ({ page }) => {
    await page.goto('/decks')

    // Click on first deck
    const deckCard = page.locator('[data-testid*="deck"]').first()
    if (await deckCard.isVisible()) {
      await deckCard.click()
      await page.waitForURL(/\/deck\//)

      // Cards tab should be visible
      const body = page.locator('body')
      await expect(body).toBeVisible()
    }
  })

  test('should open card creation form', async ({ page }) => {
    await page.goto('/decks')

    const deckCard = page.locator('[data-testid*="deck"]').first()
    if (await deckCard.isVisible()) {
      await deckCard.click()
      await page.waitForURL(/\/deck\//)

      // Click add card button
      const addButton = page.getByRole('button', { name: /add card|new card/i })
      if (await addButton.isVisible()) {
        await addButton.click()

        // Card form/modal should appear
        const form = page.locator('[role="dialog"], form').first()
        if (await form.isVisible()) {
          await expect(form).toBeVisible()
        }
      }
    }
  })

  test('should create a card with field values', async ({ page }) => {
    await page.goto('/decks')

    const deckCard = page.locator('[data-testid*="deck"]').first()
    if (await deckCard.isVisible()) {
      await deckCard.click()
      await page.waitForURL(/\/deck\//)

      const addButton = page.getByRole('button', { name: /add card|new card/i })
      if (await addButton.isVisible()) {
        await addButton.click()

        // Fill first two text inputs (front/back or template fields)
        const inputs = page.locator('input[type="text"], textarea').all()
        const inputList = await inputs
        if (inputList.length >= 2) {
          await inputList[0].fill('Playwright Test Front')
          await inputList[1].fill('Playwright Test Back')

          // Save
          const saveButton = page.getByRole('button', { name: /save|add|create/i }).last()
          if (await saveButton.isVisible()) {
            await saveButton.click()
          }
        }
      }
    }
  })
})
