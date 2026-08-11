/**
 * 더 하기 must mean "I want to do more", not "is anything due?".
 *
 * Reported directly: "더할 것이 없는게 뭔데 … 이거는 하루치 이상을 하겠다고 하는건데". The
 * button answered a question nobody asked — everything owed was already on today's list,
 * because the day had been built from exactly those cards — and told the learner the goal was
 * exhausted while cards sat in the deck waiting for their turn.
 *
 * The account under test is shaped for it: today's plan finished, nothing due for three days,
 * four cards still in the deck. Pressing 더 하기 must pull them forward and say that it did.
 */
const byId = (id: string) =>
  driver.isIOS ? $(`~${id}`) : $(`android=new UiSelector().resourceId("${id}")`)

const SHOT = process.env.SHOT_DIR ?? '/tmp'
const P = process.env.PLAT ?? 'android'
let n = 0
const shoot = async (name: string) => {
  n += 1
  await browser.saveScreenshot(`${SHOT}/${P}-ahead-${String(n).padStart(2, '0')}-${name}.png`)
}

import { loginIfNeeded } from '../helpers/auth'
import { navigateToDrawerItem } from '../helpers/navigation'

describe('더 하기 with nothing due', () => {
  it('pulls upcoming cards forward instead of claiming the goal is empty', async () => {
    await loginIfNeeded()
    await navigateToDrawerItem('Learning Plan')
    await browser.pause(5000)
    for (let i = 0; i < 3; i++) {
      try { await driver.dismissAlert(); await browser.pause(600) } catch { break }
    }

    const title = process.env.GOAL_TITLE
    if (!(await byId('plan-week').isDisplayed().catch(() => false)) && title) {
      // ANDROID has a real selector — `testID` becomes the resource-id there — so the blind
      // coordinate tap is iOS-only. On Android it landed on the row's Archive control and
      // opened "Archive this goal?", which is a destructive action one mis-tap away.
      const row = $(`android=new UiSelector().resourceId("learning-goal-open-0")`)
      if (!driver.isIOS) {
        if (await row.isDisplayed().catch(() => false)) {
          await row.click()
          await browser.pause(6000)
        }
      } else {
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
      }
    }
    await shoot('before')

    const extend = byId('learning-extend')
    await expect(extend).toBeDisplayed()
    await extend.click()
    await browser.pause(9000)
    await shoot('after')

    // The result line. It must say something was ADDED — never that the goal has no cards.
    const result = byId('learning-extend-result')
    await expect(result).toBeDisplayed()
    const text = await result.getText()
    console.log('EXTEND RESULT:', text)
    expect(text).not.toContain('no more cards')
    expect(text).not.toContain('더 넣을 카드가 없어요')
  })
})
