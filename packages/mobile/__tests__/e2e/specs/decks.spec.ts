import DecksListScreen from '../screens/DecksListScreen'
import DeckEditScreen from '../screens/DeckEditScreen'
import { navigateToTab } from '../helpers/navigation'

describe('Decks CRUD Flow', () => {
  // Assumes user is already logged in

  describe('DecksListScreen', () => {
    it('should display decks list screen', async () => {
      // Verify we're logged in (session may have been kicked by app reload)
      const { loginIfNeeded } = await import('../helpers/auth')
      await loginIfNeeded()

      // Ensure we're on a clean tab first (previous spec may leave us elsewhere)
      await navigateToTab('Home')
      await browser.pause(1000)
      await navigateToTab('Decks')
      await browser.pause(2000)
      await DecksListScreen.waitForScreen()
      expect(await DecksListScreen.isDisplayed()).toBe(true)
    })

    it('should show search bar', async () => {
      expect(await DecksListScreen.searchBar.isDisplayed()).toBe(true)
    })

    it('should show FAB create button', async () => {
      expect(await DecksListScreen.fabCreate.isDisplayed()).toBe(true)
    })
  })

  describe('Create Deck', () => {
    it('should navigate to deck edit screen on FAB tap', async () => {
      // Re-verify we're on decks list (session may have been kicked during app reload)
      if (!(await DecksListScreen.isDisplayed())) {
        const { loginIfNeeded } = await import('../helpers/auth')
        await loginIfNeeded()
        await navigateToTab('Decks')
        await browser.pause(2000)
        await DecksListScreen.waitForScreen()
      }
      await DecksListScreen.tapCreate()
      await DeckEditScreen.waitForScreen()
      expect(await DeckEditScreen.isDisplayed()).toBe(true)
    })

    it('should show name input', async () => {
      // DeckEditScreen.isDisplayed() uses platform-aware input selector
      expect(await DeckEditScreen.isDisplayed()).toBe(true)
    })

    it('should create deck with name and description', async () => {
      await DeckEditScreen.fillForm('Test Deck E2E', 'Created by Appium test')
      await DeckEditScreen.save()
      // Should navigate back to decks list
      await DecksListScreen.waitForScreen()
      expect(await DecksListScreen.isDisplayed()).toBe(true)
    })
  })

  describe('Search', () => {
    it('should filter decks by search query', async () => {
      await DecksListScreen.search('Test Deck E2E')
      await browser.pause(500) // wait for filter
      // Dismiss keyboard so tab bar is accessible for next tests
      if (driver.isIOS) {
        // Scroll to dismiss keyboard on iOS (hideKeyboard crashes WDA)
        const { scrollDown } = await import('../helpers/scroll')
        await scrollDown().catch(() => {})
      } else {
        try { await driver.hideKeyboard() } catch { /* no keyboard */ }
      }
    })
  })
})
