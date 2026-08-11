import { loginIfNeeded } from '../helpers/auth'
import { navigateToDrawerItem } from '../helpers/navigation'

/**
 * 이번 주, on a device.
 *
 * The defect this section exists to fix is a VISUAL one — the plan screen was one card and a
 * button for anyone who had not studied yet today — and no unit test can settle whether a
 * screen looks empty. The web half was photographed; this is the other half, where the strip
 * is hand-written flexbox rather than a CSS grid and can lay out differently for reasons that
 * never show up in a typecheck.
 *
 * Lookups go through `byId` because the two platforms expose `testID` differently: iOS as the
 * accessibility id, Android as the RESOURCE-ID (its content-desc is taken by whatever
 * accessible label the element already has).
 */
const byId = (id: string) =>
  driver.isIOS ? $(`~${id}`) : $(`android=new UiSelector().resourceId("${id}")`)

const SHOT = process.env.SHOT_DIR ?? '/tmp'
const P = process.env.PLAT ?? 'ios'
let n = 0
const shoot = async (name: string) => {
  n += 1
  await browser.saveScreenshot(`${SHOT}/${P}-week-${String(n).padStart(2, '0')}-${name}.png`)
}

/**
 * Not in `wdio.conf.ts`'s `specs` list: it needs an account with a goal, and which goal it
 * opens depends on `GOAL_TITLE`. Run it directly:
 *
 *   SHOT_DIR=/tmp PLAT=ios GOAL_TITLE="시뮬 학습 목표" \
 *     npx wdio wdio.ios.conf.ts --spec __tests__/e2e/specs/plan-week.spec.ts
 */
describe('the learning plan screen', () => {
  it('shows the week, and shows it on a day nothing has happened', async () => {
    await loginIfNeeded()
    await navigateToDrawerItem('Learning Plan')
    await browser.pause(5000)

    // A deep-link launch leaves SpringBoard's "Open in …?" on screen. It belongs to the
    // system, not the app, so no element selector reaches it — only the alert API.
    for (let i = 0; i < 3; i++) {
      try { await driver.dismissAlert(); await browser.pause(700) } catch { break }
    }
    await shoot('goals')

    // `navigateToDrawerItem` lands on the GOALS LIST; the plan is one tap deeper.
    //
    // The row is tapped by its TITLE, not by its testID: `LearningGoalsScreen` sets
    // `accessibilityLabel={goal.title}` AFTER `testProps`, so on iOS the element's `name` is
    // the title and `~learning-goal-open-0` matches nothing. Which account is under test
    // decides the title, so it comes from the environment.
    const title = process.env.GOAL_TITLE
    if (!(await byId('plan-week').isDisplayed().catch(() => false)) && title) {
      const row = driver.isIOS
        ? $(`~${title}`)
        : $(`android=new UiSelector().resourceId("learning-goal-open-0")`)
      if (await row.isDisplayed().catch(() => false)) {
        await row.click()
        await browser.pause(6000)
      } else if (driver.isIOS) {
        // Nothing resolves by name. Tap the row's coordinates instead — the goals list puts
        // the first row's title in a fixed place, and this spec only has to REACH the plan;
        // what it asserts is what the plan renders.
        const { width, height } = await driver.getWindowSize()
        await driver.performActions([{
          type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0,
              x: Math.round(width * 0.2), y: Math.round(height * 0.185) },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 80 },
            { type: 'pointerUp', button: 0 },
          ],
        }])
        await browser.pause(6000)
        await shoot('after-tap')
        // Neither the identifier nor the label resolves: `testProps` sets the accessibility
        // IDENTIFIER and the screen then overwrites the LABEL, and XCUITest surfaces whichever
        // it likes. The title's own StaticText is reachable, and tapping its centre hits the
        // TouchableOpacity that wraps it.
      }
    }
    await shoot('plan')

    // THE assertion. `PlanWeekCard` renders whenever the server sent a week, which is always
    // once 209 is applied — including on a day with no study, which is the state the screen
    // used to be blank in.
    const week = byId('plan-week')
    await expect(week).toBeDisplayed()

    // Scroll a little so the check card below it is in frame for the photograph.
    await browser.execute('mobile: scroll', { direction: 'down' }).catch(() => {})
    await browser.pause(800)
    await shoot('plan-scrolled')
  })
})
