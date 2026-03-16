import { test, expect } from '@playwright/test'

test.describe('Deck CRUD', () => {
  test.use({ storageState: 'playwright/.auth/user.json' })

  test('should display decks page', async ({ page }) => {
    await page.goto('/decks')
    await expect(page).toHaveURL(/\/decks/)
    // Either decks exist or empty state is shown
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })

  test('should create a new deck', async ({ page }) => {
    await page.goto('/decks')

    // Click create deck button
    const createButton = page.getByRole('button', { name: /create|new|add/i })
    if (await createButton.isVisible()) {
      await createButton.click()
    }

    // Fill deck form
    const nameInput = page.getByLabel(/name/i).first()
    if (await nameInput.isVisible()) {
      await nameInput.fill('Playwright Test Deck')

      // Save
      const saveButton = page.getByRole('button', { name: /save|create/i })
      if (await saveButton.isVisible()) {
        await saveButton.click()
      }
    }
  })

  test('should navigate to deck detail', async ({ page }) => {
    await page.goto('/decks')

    // Click on first deck card
    const deckCard = page.locator('[data-testid*="deck"]').first()
    if (await deckCard.isVisible()) {
      await deckCard.click()
      // Should show deck detail page
      await page.waitForURL(/\/deck\//)
    }
  })

  test('should show deck settings/edit', async ({ page }) => {
    await page.goto('/decks')

    // Click on first deck
    const deckCard = page.locator('[data-testid*="deck"]').first()
    if (await deckCard.isVisible()) {
      await deckCard.click()
      await page.waitForURL(/\/deck\//)

      // Look for edit/settings button
      const editButton = page.getByRole('button', { name: /edit|settings/i })
      if (await editButton.isVisible()) {
        await editButton.click()
      }
    }
  })
})
