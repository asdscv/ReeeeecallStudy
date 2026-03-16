class MarketplaceScreenPO {
  get screen() { return $('~marketplace-screen') }
  get searchBar() { return $('~marketplace-search') }
  get acquireButton() { return $('~marketplace-acquire-button') }

  async waitForScreen() { await this.screen.waitForDisplayed({ timeout: 10000 }) }
  async isDisplayed() { return this.screen.isDisplayed() }

  async search(query: string) { await this.searchBar.setValue(query) }
  async selectCategory(cat: string) { await $(`~marketplace-cat-${cat}`).click() }
}

export default new MarketplaceScreenPO()
