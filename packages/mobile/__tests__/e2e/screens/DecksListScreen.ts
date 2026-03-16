class DecksListScreenPO {
  get screen() { return $('~decks-list-screen') }
  get searchBar() { return $('~decks-search') }
  get fabCreate() { return $('~decks-fab-create') }
  get emptyState() { return $('~decks-empty') }

  async waitForScreen() {
    await this.screen.waitForDisplayed({ timeout: 10000 })
  }

  async isDisplayed(): Promise<boolean> {
    return this.screen.isDisplayed()
  }

  async tapCreate() {
    await this.fabCreate.click()
  }

  async search(query: string) {
    await this.searchBar.setValue(query)
  }

  async getDeckCard(deckId: string) {
    return $(`~deck-card-${deckId}`)
  }
}

export default new DecksListScreenPO()
