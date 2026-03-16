class DeckEditScreenPO {
  get screen() { return $('~deck-edit-screen') }
  get nameInput() { return $('~deck-edit-name') }
  get descriptionInput() { return $('~deck-edit-description') }
  get saveButton() { return $('~deck-edit-save') }

  async waitForScreen() {
    await this.screen.waitForDisplayed({ timeout: 10000 })
  }

  async isDisplayed(): Promise<boolean> {
    return this.screen.isDisplayed()
  }

  async fillForm(name: string, description?: string) {
    await this.nameInput.setValue(name)
    if (description) {
      await this.descriptionInput.setValue(description)
    }
  }

  async save() {
    await this.saveButton.click()
  }
}

export default new DeckEditScreenPO()
