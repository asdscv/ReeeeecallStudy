class MarketplaceScreenPO {
  get screen() { return $('~marketplace-screen') }
  get searchBar() { return $('~marketplace-search') }
  get acquireButton() { return $('~marketplace-acquire-button') }

  async waitForScreen() {
    try {
      await this.screen.waitForDisplayed({ timeout: 5000 })
    } catch {
      await this.searchBar.waitForDisplayed({ timeout: 10000 })
    }
  }
  async isDisplayed() {
    return (await this.screen.isDisplayed().catch(() => false)) ||
           (await this.searchBar.isDisplayed().catch(() => false))
  }

  async search(query: string) { await this.searchBar.setValue(query) }
  async selectCategory(cat: string) { await $(`~marketplace-cat-${cat}`).click() }
}

export default new MarketplaceScreenPO()
