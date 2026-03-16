class DashboardScreenPO {
  get screen() { return $('~dashboard-screen') }
  get statDue() { return $('~dashboard-stat-due') }
  get statNew() { return $('~dashboard-stat-new') }
  get statTotal() { return $('~dashboard-stat-total') }
  get quickStudy() { return $('~dashboard-quick-study') }
  get logoutButton() { return $('~dashboard-logout') }

  async waitForScreen() {
    await this.screen.waitForDisplayed({ timeout: 15000 })
  }

  async isDisplayed(): Promise<boolean> {
    return this.screen.isDisplayed()
  }

  async tapLogout() {
    await this.logoutButton.click()
  }
}

export default new DashboardScreenPO()
