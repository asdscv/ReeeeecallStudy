/**
 * Learning engine — the list, and the plan you open from it.
 *
 * These are deliberately NOT re-tests of the arithmetic: `summarizeLearning` is a pure
 * function with its own unit tests, and re-asserting percentages through a simulator would
 * be slow and no more convincing. What only a real device can answer is what these check:
 *
 *   1. the screens are reachable and mount at all on this platform's runtime;
 *   2. no string reaches the user as a RAW i18n KEY. This shipped broken — `today.rate.*`
 *      and the whole `today.error.*` / `goals.error.*` families were absent from all eight
 *      mobile bundles, so the three self-rating buttons rendered the literal text
 *      "today.rate.again". A unit test could not see it: the keys are built at runtime and
 *      i18next's fallback is to echo the key;
 *   3. the primary actions are actually big enough to hit. Measured on the device, in the
 *      device's own units — 44pt is the iOS HIG minimum, 48dp Material's.
 */
import { navigateToDrawerItem } from '../helpers/navigation'
import { LearningToday, LearningGoals, measuredHeight } from '../screens/LearningScreens'

/**
 * Any `namespace.key.path` that leaked into rendered text.
 *
 * Scoped to the learning namespace's own roots so an unrelated identifier elsewhere in the
 * tree cannot fail the test. i18next renders a missing key by echoing it verbatim, which is
 * exactly the shape this matches.
 */
const RAW_KEY = /\b(today|goals|form|insights|recommend|enrichment)\.[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*\b/g

/**
 * testIDs are themselves dotted-free, but Android exposes them as content-desc, and the
 * page source therefore contains our own ids. Only TEXT attributes are searched.
 */
function rawKeysInText(pageSource: string): string[] {
  const texts: string[] = []
  for (const m of pageSource.matchAll(/(?:\btext|\bvalue|\blabel)="([^"]*)"/g)) texts.push(m[1])
  const found = new Set<string>()
  for (const text of texts) {
    // Our own testIDs are surfaced as label/value on Android; they never contain a dot.
    for (const hit of text.matchAll(RAW_KEY)) found.add(hit[0])
  }
  return [...found]
}

/** 44pt on iOS; the same 44 expressed in device pixels on Android (dp × density). */
async function minTouchPx(): Promise<number> {
  if (driver.isIOS) return 44
  const density = await driver.getDisplayDensity().catch(() => 0)
  // 160dpi = density 1. Fall back to 44 if the driver will not say, so the check degrades
  // to "at least 44 pixels" rather than silently passing.
  return density > 0 ? Math.round(44 * (density / 160)) : 44
}

describe('Learning engine screens', () => {
  before(async () => {
    await navigateToDrawerItem('Learning Plan')
    await browser.pause(1500)
  })

  it('opens the plan LIST from the drawer', async () => {
    // The drawer used to land inside one plan, chosen for you. It lands on the list now.
    const shown = await LearningGoals.waitForScreen()
    if (!shown) await browser.saveScreenshot('./test-results/learning-goals-not-found.png')
    expect(shown).toBe(true)
  })

  it('renders no raw i18n key anywhere on the plan list', async () => {
    await LearningGoals.waitForScreen()
    const leaked = rawKeysInText(await LearningGoals.pageSource())
    if (leaked.length > 0) {
      console.log('[learning] raw keys on today screen:', leaked.join(', '))
      await browser.saveScreenshot('./test-results/learning-today-raw-keys.png')
    }
    expect(leaked).toEqual([])
  })

  it('opens the goal form, which asks for three things and answers the fourth', async () => {
    await LearningGoals.waitForScreen()
    expect(await LearningGoals.toggleCreateForm()).toBe(true)

    const [title, save, horizon] = await Promise.all([
      LearningGoals.hasTitleInput(),
      LearningGoals.hasSaveButton(),
      LearningGoals.hasHorizonChip(3),
    ])
    expect(title).toBe(true)
    expect(save).toBe(true)
    // Horizon chips instead of a calendar: a native date picker would mean a new native
    // dependency, and every release would become a store rebuild rather than an OTA.
    expect(horizon).toBe(true)

    const leaked = rawKeysInText(await LearningGoals.pageSource())
    if (leaked.length > 0) console.log('[learning] raw keys on goal form:', leaked.join(', '))
    expect(leaked).toEqual([])

    await LearningGoals.toggleCreateForm()
  })

  it('opens a plan from the list, or shows the empty state — never a dead end', async () => {
    await LearningGoals.waitForScreen()
    const opened = await LearningGoals.openPlan(0)
    if (!opened) {
      // No goals yet. The list must then say so rather than render an empty page.
      await browser.saveScreenshot('./test-results/learning-goals-empty.png')
      expect(await LearningGoals.isDisplayed()).toBe(true)
      return
    }

    expect(await LearningToday.waitForScreen()).toBe(true)

    const [generate, regenerate, createGoal] = await Promise.all([
      LearningToday.hasGenerateAction(),
      LearningToday.hasRegenerateAction(),
      LearningToday.hasCreateGoalCta(),
    ])
    // A plan offering none of the three is a dead end, which is the state this guards against.
    expect(generate || regenerate || createGoal).toBe(true)

    const leaked = rawKeysInText(await LearningToday.pageSource())
    if (leaked.length > 0) {
      console.log('[learning] raw keys on the plan:', leaked.join(', '))
      await browser.saveScreenshot('./test-results/learning-plan-raw-keys.png')
    }
    expect(leaked).toEqual([])
  })

  it('sizes the primary action to the platform minimum', async () => {
    const min = await minTouchPx()
    const { id: measuredId, height: measured } = await measuredHeight([
      'learning-rate-known-0', 'learning-generate', 'learning-regenerate', 'learning-create-goal',
      'learning-goal-new',
    ])

    expect(measured).toBeGreaterThan(0)
    console.log(`[learning] ${measuredId} height=${measured} required>=${min}`)
    // Rounded down by a pixel on some densities, hence the -1 tolerance.
    expect(measured).toBeGreaterThanOrEqual(min - 1)
  })

  it('gets back to the list from inside a plan', async () => {
    // The plan has exactly one way out now. Two header links that both went to the same place —
    // one of them labelled for a screen that no longer exists — was the shape this replaced.
    if (!await LearningToday.isDisplayed()) return
    expect(await LearningToday.openGoals()).toBe(true)
    expect(await LearningGoals.waitForScreen()).toBe(true)
  })
})
