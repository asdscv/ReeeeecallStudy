/**
 * Page objects for the learning screens.
 *
 * One file, three objects: they are navigated as a set (the plan list, and the plan you open from it),
 * and splitting them would only duplicate the same platform-selector plumbing three times.
 *
 * Selector note: `testProps()` sets `testID` on both platforms and additionally an
 * `accessibilityLabel` on Android, because Appium's `~` strategy reads content-desc there
 * while `testID` lands on resource-id. So `~id` works on both, and `byResourceId` stays as
 * the Android fallback for elements whose accessibility label is overridden.
 */

function byTestId(id: string) {
  return $(`~${id}`)
}

function byResourceId(id: string) {
  return $(`android=new UiSelector().resourceId("${id}")`)
}

/** Present on either platform, whichever selector strategy happens to resolve. */
async function exists(id: string): Promise<boolean> {
  if (await byTestId(id).isExisting().catch(() => false)) return true
  if (driver.isAndroid && await byResourceId(id).isExisting().catch(() => false)) return true
  return false
}

async function element(id: string) {
  if (await byTestId(id).isExisting().catch(() => false)) return byTestId(id)
  if (driver.isAndroid) return byResourceId(id)
  return byTestId(id)
}

async function waitForId(id: string, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await exists(id)) return true
    await browser.pause(500)
  }
  return false
}

async function tap(id: string): Promise<boolean> {
  if (!await waitForId(id, 8000)) return false
  const el = await element(id)
  await el.click().catch(() => {})
  await browser.pause(600)
  return true
}

/**
 * Leave a pushed screen.
 *
 * The drawer hamburger only exists on root screens, so `navigateToDrawerItem` cannot get off
 * a `mode="back"` screen — it silently does nothing and the next assertion then runs against
 * the wrong screen. iOS has no hardware back, hence the header control.
 */
export async function goBack(): Promise<void> {
  if (await exists('screen-header-back')) {
    const el = await element('screen-header-back')
    await el.click().catch(() => {})
  } else if (driver.isAndroid) {
    await driver.back().catch(() => {})
  }
  await browser.pause(800)
}

class LearningTodayPO {
  readonly screenId = 'learning-today-screen'

  waitForScreen(timeoutMs = 20000) { return waitForId(this.screenId, timeoutMs) }
  isDisplayed() { return exists(this.screenId) }

  /** Either the plan exists (generate → regenerate) or it does not (generate). */
  hasGenerateAction() { return exists('learning-generate') }
  hasRegenerateAction() { return exists('learning-regenerate') }
  hasCreateGoalCta() { return exists('learning-create-goal') }

  planItem(index = 0) { return exists(`learning-plan-item-${index}`) }
  ratingButton(kind: 'again' | 'partial' | 'known', index = 0) {
    return exists(`learning-rate-${kind}-${index}`)
  }
  tapRating(kind: 'again' | 'partial' | 'known', index = 0) {
    return tap(`learning-rate-${kind}-${index}`)
  }
  recorded(index = 0) { return exists(`learning-item-recorded-${index}`) }

  /** Get back to the today screen from wherever the previous test left off. */
  async ensureVisible(): Promise<boolean> {
    for (let i = 0; i < 3; i++) {
      if (await exists(this.screenId)) return true
      await goBack()
    }
    return exists(this.screenId)
  }

  /** The plan's only way out: back to the list. */
  openGoals() { return tap('learning-back-to-plans') }
  openGoalsFromEmptyState() { return tap('learning-create-goal') }

  /** Goal progress, which replaced the chip row that used to switch plans from inside one. */
  hasProgress() { return exists('learning-progress') }

  async pageSource(): Promise<string> {
    return (await browser.getPageSource().catch(() => '')) ?? ''
  }
}

class LearningGoalsPO {
  readonly screenId = 'learning-goals-screen'

  waitForScreen(timeoutMs = 20000) { return waitForId(this.screenId, timeoutMs) }
  isDisplayed() { return exists(this.screenId) }

  toggleCreateForm() { return tap('learning-goal-new') }
  hasTitleInput() { return exists('learning-goal-title') }
  hasSaveButton() { return exists('learning-goal-save') }
  /**
   * The form asks for three things now. 과목 was removed (the shipped adapters are identical
   * apart from their id), 덱별 중요도 was removed (the app can infer it better than the learner),
   * and 하루 몇 분 became an output — `learning-goal-plan-summary` is where it is reported.
   */
  hasHorizonChip(months: 1 | 3 | 6 | 12) { return exists(`learning-goal-horizon-${months}`) }
  selectHorizon(months: 1 | 3 | 6 | 12) { return tap(`learning-goal-horizon-${months}`) }
  hasPlanSummary() { return exists('learning-goal-plan-summary') }

  async typeTitle(value: string) {
    if (!await waitForId('learning-goal-title', 8000)) return false
    const el = await element('learning-goal-title')
    await el.click().catch(() => {})
    await el.setValue(value).catch(() => {})
    return true
  }

  goalCard(index = 0) { return exists(`learning-goal-${index}`) }
  archiveAction(index = 0) { return exists(`learning-goal-archive-${index}`) }

  /** The list is the way into a plan now — the card title opens it. */
  openPlan(index = 0) { return tap(`learning-goal-open-${index}`) }

  async pageSource(): Promise<string> {
    return (await browser.getPageSource().catch(() => '')) ?? ''
  }
}

/**
 * Measured height of whichever of `ids` is on screen, in device pixels.
 *
 * Uses the same dual selector strategy as the rest of this file: `~id` resolves against
 * content-desc on Android and accessibilityIdentifier on iOS, and resource-id is the
 * fallback for anything whose accessibility label is overridden.
 */
export async function measuredHeight(ids: readonly string[]): Promise<{ id: string; height: number }> {
  for (const id of ids) {
    for (const el of [byTestId(id), ...(driver.isAndroid ? [byResourceId(id)] : [])]) {
      if (!await el.isExisting().catch(() => false)) continue
      const size = await el.getSize().catch(() => null)
      if (size && size.height > 0) return { id, height: size.height }
    }
  }
  return { id: '', height: 0 }
}

export const LearningToday = new LearningTodayPO()
export const LearningGoals = new LearningGoalsPO()
