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
  /**
   * 카테고리를 고릅니다.
   *
   * 세 단계입니다: **필터 패널을 열고**(`marketplace-filter-toggle`) → 그 안의 카테고리
   * 드롭다운을 열고(`marketplace-category-dropdown`) → 항목을 누릅니다(`marketplace-cat-*`).
   * 화면에 보이는 것은 검색·정렬·필터 버튼뿐이라, 바로 항목을 클릭하면 "element wasn't found"
   * 로 실패합니다 — 화면이 깨진 것이 아니라 두 단계를 건너뛴 것입니다.
   */
  async selectCategory(cat: string) {
    const option = $(`~marketplace-cat-${cat}`)
    if (await option.isDisplayed().catch(() => false)) { await option.click(); return }

    const dropdown = $('~marketplace-category-dropdown')
    if (!(await dropdown.isDisplayed().catch(() => false))) {
      await $('~marketplace-filter-toggle').click().catch(() => {})
      await dropdown.waitForDisplayed({ timeout: 8000 })
    }
    await dropdown.click()
    await option.waitForDisplayed({ timeout: 8000 })
    await option.click()
  }
}

export default new MarketplaceScreenPO()
