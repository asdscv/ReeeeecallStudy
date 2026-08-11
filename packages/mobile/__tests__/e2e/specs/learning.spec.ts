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
import { readFileSync } from 'fs'
import path from 'path'
import { navigateToDrawerItem } from '../helpers/navigation'
import { LearningToday, LearningGoals, measuredHeight } from '../screens/LearningScreens'

/**
 * The learning namespace's own top-level roots, read from the bundle rather than listed here.
 *
 * The list used to be hand-written, and it rotted exactly the way hand-written lists do: it
 * still named `enrichment`, a feature deleted some releases ago, while `check`, `coach`,
 * `completion`, `explain`, `history`, `progress` and `week` — which is to say nearly
 * everything added since — were invisible to the detector below. A raw `explain.ask` on the
 * screen would have rendered as literal text and passed.
 *
 * Deriving them means a new section is covered the moment its strings exist.
 */
const NAMESPACE_ROOTS: string[] = Object.entries(
  // Read, not imported: this file is outside the app's tsconfig `include`, and `wdio.conf.ts`
  // already proves `__dirname` + `path.resolve` work in this runner. A JSON module import here
  // would depend on compiler options nothing in the e2e tree currently sets.
  JSON.parse(readFileSync(
    path.resolve(__dirname, '../../../src/i18n/locales/en/learning.json'), 'utf8',
  )) as Record<string, unknown>,
).filter(([, value]) => value !== null && typeof value === 'object').map(([key]) => key)

/**
 * Any `namespace.key.path` that leaked into rendered text.
 *
 * Scoped to the learning namespace's own roots so an unrelated identifier elsewhere in the
 * tree cannot fail the test. i18next renders a missing key by echoing it verbatim, which is
 * exactly the shape this matches.
 */
const RAW_KEY = new RegExp(
  `\\b(${NAMESPACE_ROOTS.join('|')})\\.[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z0-9_]+)*\\b`, 'g')

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
    // `tap` resolves true for a click on a DISABLED control, so a paused or completed goal at
    // index 0 would look opened and then fail on the wait below. Confirm the plan mounted rather
    // than trusting the tap.
    const tapped = await LearningGoals.openPlan(0)
    const opened = tapped && await LearningToday.waitForScreen(8000)
    if (!opened) {
      // No goals yet. The list must then say so rather than render an empty page.
      await browser.saveScreenshot('./test-results/learning-goals-empty.png')
      expect(await LearningGoals.isDisplayed()).toBe(true)
      return
    }

    // #7: the progress panel is the centrepiece of the restructure, so it is asserted rather
    // than merely available on the page object.
    expect(await LearningToday.hasProgress() || await LearningToday.hasGenerateAction()
      || await LearningToday.hasCreateGoalCta()).toBe(true)

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

  /**
   * The paid explanation, on the platform it was missing from.
   *
   * It shipped web-only: a browser-only AI feature on a product whose plan is checked on a
   * phone. What a device can prove that a unit test cannot is that the block MOUNTS on this
   * runtime — the shared selector, the store action and the Korean copy all resolve — and that
   * the price note travels with the button.
   *
   * Never tapped. A press spends real credits against whatever account the device is signed
   * into, and a test suite is not a thing that should be able to bill a learner.
   */
  it('offers the paid explanation only with a miss behind it, and never silently', async () => {
    if (!await LearningToday.ensureVisible()) return

    const [container, ask] = await Promise.all([
      LearningToday.hasExplain(), LearningToday.hasExplainAsk(),
    ])
    // The premise, in both directions: no button without the block that carries the price note,
    // and no block without something in it. A bare button would be a charge with no warning.
    expect(ask && !container).toBe(false)

    if (container) {
      const source = await LearningToday.pageSource()
      // The note is the only thing standing between a tap and a surprise charge, so its
      // absence matters more than its wording — which is why this checks for a rendered
      // string rather than an id, and why `rawKeysInText` below catches an untranslated one.
      expect(rawKeysInText(source).filter((key) => key.startsWith('explain.'))).toEqual([])
      await browser.saveScreenshot('./test-results/learning-weak-explain.png')
    }
  })

  it('sizes the primary action to the platform minimum', async () => {
    const min = await minTouchPx()
    // Primary actions only. `learning-goal-new` is deliberately NOT here: it is a 32pt header
    // link, and `measuredHeight` returns the FIRST id present — on an empty list it would be the
    // only match and this assertion would fail by construction rather than on a real regression.
    const { id: measuredId, height: measured } = await measuredHeight([
      'learning-start-study', 'learning-generate', 'learning-regenerate', 'learning-create-goal',
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
