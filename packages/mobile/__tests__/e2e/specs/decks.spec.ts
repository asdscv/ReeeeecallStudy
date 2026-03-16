import DecksListScreen from '../screens/DecksListScreen'
import DeckEditScreen from '../screens/DeckEditScreen'

describe('Decks CRUD Flow', () => {
  // Assumes user is already logged in

  describe('DecksListScreen', () => {
    it('should display decks list screen', async () => {
      // Navigate to Decks tab
      const decksTab = $('~DecksTab')
      if (await decksTab.isDisplayed()) {
        await decksTab.click()
      }
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
      await DecksListScreen.tapCreate()
      await DeckEditScreen.waitForScreen()
      expect(await DeckEditScreen.isDisplayed()).toBe(true)
    })

    it('should show name input', async () => {
      expect(await DeckEditScreen.nameInput.isDisplayed()).toBe(true)
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
      // Deck should still be visible
      await browser.pause(500) // wait for filter
    })
  })
})
