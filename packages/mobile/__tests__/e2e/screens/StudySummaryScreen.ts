class StudySummaryScreenPO {
  get screen() { return $('~study-summary-screen') }
  get cardsStudied() { return $('~summary-cards') }
  get accuracy() { return $('~summary-accuracy') }
  get time() { return $('~summary-time') }
  get studyAgainButton() { return $('~summary-study-again') }
  get doneButton() { return $('~summary-back-to-deck') }

  async waitForScreen() { await this.screen.waitForDisplayed({ timeout: 10000 }) }
  async isDisplayed() { return this.screen.isDisplayed() }
  async tapStudyAgain() { await this.studyAgainButton.click() }
  async tapDone() { await this.doneButton.click() }
}

export default new StudySummaryScreenPO()
