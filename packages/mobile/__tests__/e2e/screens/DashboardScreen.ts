class DashboardScreenPO {
  get screen() { return $('~dashboard-screen') }
  get statDue() { return $('~dashboard-stat-due') }
  get statNew() { return $('~dashboard-stat-new') }
  get statTotal() { return $('~dashboard-stat-total') }
  get quickStudy() { return $('~dashboard-quick-study') }
  get logoutButton() { return $('~dashboard-logout') }

  async waitForScreen() {
    try {
      await this.screen.waitForDisplayed({ timeout: 5000 })
    } catch {
      await this.statDue.waitForDisplayed({ timeout: 10000 })
    }
  }

  async isDisplayed(): Promise<boolean> {
    return (await this.screen.isDisplayed().catch(() => false)) ||
           (await this.statDue.isDisplayed().catch(() => false))
  }

  async tapLogout() {
    await this.logoutButton.click()
  }
}

export default new DashboardScreenPO()
