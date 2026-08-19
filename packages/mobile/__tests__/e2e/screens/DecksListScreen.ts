import { byPlatformId } from '../helpers/navigation'

/**
 * 셀렉터는 **플랫폼별로** 만듭니다.
 *
 * `~id` 는 iOS 에서만 통합니다. Android 에서 `testID` 는 resource-id 로 가고 content-desc 에는
 * `accessibilityLabel` 이 실리는데, FAB 나 검색창처럼 라벨을 따로 주는 컴포넌트는 그 자리를
 * 라벨이 차지해 `~decks-fab-create` 가 못 맞습니다 — 화면에는 버튼이 멀쩡히 보이는데도요.
 */
class DecksListScreenPO {
  get screen() { return byPlatformId('decks-list-screen') }
  get searchBar() { return byPlatformId('decks-search') }
  get fabCreate() { return byPlatformId('decks-fab-create') }
  get emptyState() { return byPlatformId('decks-empty') }

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
