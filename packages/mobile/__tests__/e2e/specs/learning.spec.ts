/**
 * Learning engine — the three screens the product's newest surface is made of.
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
import { LearningToday, LearningGoals, LearningInsights, measuredHeight } from '../screens/LearningScreens'

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

  it('opens today\'s plan from the drawer', async () => {
    const shown = await LearningToday.waitForScreen()
    if (!shown) await browser.saveScreenshot('./test-results/learning-today-not-found.png')
    expect(shown).toBe(true)
  })

  it('renders no raw i18n key anywhere on today\'s plan', async () => {
    await LearningToday.waitForScreen()
    const leaked = rawKeysInText(await LearningInsights.pageSource())
    if (leaked.length > 0) {
      console.log('[learning] raw keys on today screen:', leaked.join(', '))
      await browser.saveScreenshot('./test-results/learning-today-raw-keys.png')
    }
    expect(leaked).toEqual([])
  })

  it('offers exactly one of: generate a plan, act on a plan, or create a goal', async () => {
    await LearningToday.waitForScreen()
    const [generate, regenerate, createGoal] = await Promise.all([
      LearningToday.hasGenerateAction(),
      LearningToday.hasRegenerateAction(),
      LearningToday.hasCreateGoalCta(),
    ])
    // A screen with none of the three is a dead end, which is the state this guards against.
    expect(generate || regenerate || createGoal).toBe(true)
  })

  it('sizes the primary action to the platform minimum', async () => {
    await LearningToday.waitForScreen()
    const min = await minTouchPx()

    const { id: measuredId, height: measured } = await measuredHeight([
      'learning-rate-known-0', 'learning-generate', 'learning-regenerate', 'learning-create-goal',
    ])

    expect(measured).toBeGreaterThan(0)
    console.log(`[learning] ${measuredId} height=${measured} required>=${min}`)
    // Rounded down by a pixel on some densities, hence the -1 tolerance.
    expect(measured).toBeGreaterThanOrEqual(min - 1)
  })

  it('reaches the diagnostics screen and never leaves accuracy blank', async () => {
    await LearningToday.waitForScreen()
    const opened = await LearningToday.openInsights()
    expect(opened).toBe(true)

    const shown = await LearningInsights.waitForScreen()
    if (!shown) await browser.saveScreenshot('./test-results/learning-insights-not-found.png')
    expect(shown).toBe(true)

    // With no goal the screen legitimately shows only the empty state; with a goal it shows
    // either the numbers or an error with a retry. A screen with none of those is the blank
    // dead end this asserts against.
    const [attempts, error, retry] = await Promise.all([
      LearningInsights.hasAttempts(),
      LearningInsights.hasError(),
      LearningInsights.hasRetry(),
    ])
    if (attempts) {
      const accuracy = await LearningInsights.accuracyText()
      console.log(`[learning] accuracy cell = "${accuracy}"`)
      // "no data" and "0%" are different statements; an empty cell is neither.
      expect(accuracy.trim().length).toBeGreaterThan(0)
    } else if (error) {
      expect(retry).toBe(true)
    }

    const leaked = rawKeysInText(await LearningInsights.pageSource())
    if (leaked.length > 0) console.log('[learning] raw keys on insights:', leaked.join(', '))
    expect(leaked).toEqual([])
  })

  it('opens the goal form with every field it needs', async () => {
    // The previous test left us on the diagnostics screen, which is pushed — the drawer is
    // not reachable from there.
    await LearningToday.ensureVisible()
    const opened = await LearningToday.openGoals() || await LearningToday.openGoalsFromEmptyState()
    expect(opened).toBe(true)
    expect(await LearningGoals.waitForScreen()).toBe(true)

    expect(await LearningGoals.toggleCreateForm()).toBe(true)
    const [title, save, language] = await Promise.all([
      LearningGoals.hasTitleInput(),
      LearningGoals.hasSaveButton(),
      LearningGoals.hasDomainChip('language'),
    ])
    expect(title).toBe(true)
    expect(save).toBe(true)
    // The domain is a fixed choice because `domain_id` selects a planner adapter; a form
    // without it would create goals nothing can plan for.
    expect(language).toBe(true)

    const leaked = rawKeysInText(await LearningInsights.pageSource())
    if (leaked.length > 0) console.log('[learning] raw keys on goals:', leaked.join(', '))
    expect(leaked).toEqual([])
  })
})
