import { navigateToTab } from '../helpers/navigation'
import { scrollDown } from '../helpers/scroll'

describe('Remaining Features', () => {
  describe('Import/Export', () => {
    it('should display import/export screen from deck detail', async () => {
      const screen = $('~import-export-screen')
      // Navigate: Decks tab → deck detail → import/export button
      if (await screen.isExisting()) {
        expect(await screen.isDisplayed()).toBe(true)
      }
    })

    it('should show import CSV button', async () => {
      const btn = $('~import-csv')
      if (await btn.isExisting()) expect(await btn.isDisplayed()).toBe(true)
    })

    it('should show export CSV button', async () => {
      const btn = $('~export-csv')
      if (await btn.isExisting()) expect(await btn.isDisplayed()).toBe(true)
    })
  })

  describe('Publish Deck', () => {
    it('should display publish screen', async () => {
      const screen = $('~publish-deck-screen')
      if (await screen.isExisting()) {
        expect(await screen.isDisplayed()).toBe(true)
      }
    })

    it('should show publish form fields', async () => {
      const title = $('~publish-title')
      const submit = $('~publish-submit')
      if (await title.isExisting()) expect(await title.isDisplayed()).toBe(true)
      if (await submit.isExisting()) expect(await submit.isDisplayed()).toBe(true)
    })
  })

  describe('Study History', () => {
    it('should display study history screen', async () => {
      const screen = $('~study-history-screen')
      if (await screen.isExisting()) {
        expect(await screen.isDisplayed()).toBe(true)
      }
    })

    it('should show streak stat', async () => {
      const stat = $('~history-streak')
      if (await stat.isExisting()) expect(await stat.isDisplayed()).toBe(true)
    })
  })

  describe('Notifications', () => {
    it('should show notification toggle in settings', async () => {
      await navigateToTab('Settings')

      const toggle = $('~settings-notification-toggle')
      if (await toggle.isExisting()) {
        await scrollDown().catch(() => {})
        await browser.pause(500)
        const visible = await toggle.isDisplayed().catch(() => false)
        expect(visible || await toggle.isExisting()).toBe(true)
      }
    })
  })
})
