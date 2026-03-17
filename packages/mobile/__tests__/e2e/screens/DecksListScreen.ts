class DecksListScreenPO {
  get screen() { return $('~decks-list-screen') }
  get searchBar() { return $('~decks-search') }
  get fabCreate() { return $('~decks-fab-create') }
  get emptyState() { return $('~decks-empty') }

  async waitForScreen() {
    // SafeAreaView testID may not be accessible on iOS — try child elements
    try {
      await this.screen.waitForDisplayed({ timeout: 5000 })
    } catch {
      try {
        await this.searchBar.waitForDisplayed({ timeout: 5000 })
      } catch {
        await this.fabCreate.waitForDisplayed({ timeout: 5000 })
      }
    }
  }

  async isDisplayed(): Promise<boolean> {
    return (await this.screen.isDisplayed().catch(() => false)) ||
           (await this.searchBar.isDisplayed().catch(() => false)) ||
           (await this.fabCreate.isDisplayed().catch(() => false))
  }

  async tapCreate() {
    await this.fabCreate.waitForDisplayed({ timeout: 5000 })
    await this.fabCreate.click()
  }

  async search(query: string) {
    await this.searchBar.waitForDisplayed({ timeout: 5000 })
    await this.searchBar.setValue(query)
  }

  async getDeckCard(deckId: string) {
    return $(`~deck-card-${deckId}`)
  }
}

export default new DecksListScreenPO()
