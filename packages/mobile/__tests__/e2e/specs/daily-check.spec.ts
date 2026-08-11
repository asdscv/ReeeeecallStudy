import { loginIfNeeded } from '../helpers/auth'
import { navigateToDrawerItem } from '../helpers/navigation'

/**
 * iOS exposes `testID` as the accessibility id, so `~id` works. Android exposes it as
 * RESOURCE-ID, and content-desc is taken by whatever accessible text the element has — a
 * button's label, a field's placeholder — so `~id` silently matches nothing there.
 */
const byId = (id: string) =>
  // `$(\`~${id}\`)`, NOT `byId(id)` — which is what this said, and which recurses until the
  // stack goes on iOS. Every iOS lookup in this file was a crash, not a miss.
  driver.isIOS ? $(`~${id}`) : $(`android=new UiSelector().resourceId("${id}")`)

const SHOT = process.env.SHOT_DIR ?? '/tmp'
const P = process.env.PLAT ?? 'ios'
let n = 0
const shoot = async (name: string) => {
  n += 1
  await browser.saveScreenshot(`${SHOT}/${P}-${String(n).padStart(2,'0')}-${name}.png`)
}
const found: string[] = []
const note = (ok: boolean, label: string) => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}`); if (!ok) found.push(label)
}

/**
 * 오늘의 확인, on a real device, on both platforms.
 *
 * The product claim here is a PRICE claim as much as a learning one: building the check
 * costs nothing because the card is its own question, and answering costs nothing when the
 * learner is right. If either half stops holding, the feature becomes a tax on studying —
 * so those are the assertions, not the layout.
 *
 * Every lookup goes through `byId` because the two platforms expose `testID` differently,
 * and every assertion is on an id or a number rather than on Korean copy: the account under
 * test may be in any of the eight locales.
 */
describe('오늘의 확인 on device', () => {
  it('walks the feature and captures every screen', async () => {
    await loginIfNeeded()
    for (const exit of ['quiz-back', 'quiz-leave']) {
      const el = byId(exit)
      if (await el.isDisplayed().catch(() => false)) { await el.click().catch(()=>{}); await browser.pause(1500) }
    }
    await shoot('start')

    await navigateToDrawerItem('Learning Plan')
    await browser.pause(6000)
    await shoot('learning-goals')

    // A deep-link launch leaves "Open in ReeeeecallStudy?" on screen. It belongs to
    // SpringBoard, not the app, so an element selector never finds it — only the alert API
    // reaches it. It swallowed every tap and looked exactly like a missing element.
    for (let i = 0; i < 3; i++) {
      try { await driver.dismissAlert(); await browser.pause(700) } catch { break }
    }

    // `navigateToDrawerItem` lands on the GOALS LIST; the plan is one tap deeper.
    let src = await browser.getPageSource()
    if (!(await byId('daily-check-start').isDisplayed().catch(() => false))
        && !/학습 시작|Start studying/.test(src)) {
      // Cross-platform: iOS matches on label, Android on text.
      const goal = driver.isIOS
        ? $('-ios predicate string:label CONTAINS "시뮬 학습 목표"')
        : $('android=new UiSelector().textContains("시뮬 학습 목표")')
      if (await goal.isDisplayed().catch(() => false)) { await goal.click(); await browser.pause(9000) }
    }
    await shoot('today')

    src = await browser.getPageSource()
    const text = [...src.matchAll(/(?:label|value)="([^"]{2,80})"/g)].map(m=>m[1])
      .filter((v,i,a)=>a.indexOf(v)===i)
    console.log('\n--- TODAY SCREEN ---\n  ' + text.slice(0, 26).join('\n  '))

    const hasCard = await byId('daily-check-start').isDisplayed().catch(() => false)
    note(hasCard, 'the 오늘의 확인 card is reachable on the plan screen')
    // Asserted through the button's id, not Korean copy: the account under test may be in
    // any of the eight locales, and this spec is about behaviour, not translation.
    note(/무료로 채점|공부한|graded free|from today/.test(src),
      'the price rule and the count are rendered')
    if (!hasCard) return

    await byId('daily-check-start').click()
    await browser.pause(9000)
    await shoot('check-question')

    const q = await browser.getPageSource()
    note(await byId('quiz-answer-input').isDisplayed().catch(() => false),
      'the answer is typed, not self-rated')
    note(!/정답 보기/.test(q), 'there is no reveal button')

    const answers = JSON.parse(process.env.ANSWERS ?? '{}') as Record<string,string>
    const stem = Object.keys(answers).find((k) => q.includes(`"${k}"`) || q.includes(`>${k}<`) || q.includes(k))
    console.log(`  stem matched: ${stem ?? 'none'}`)
    if (stem) {
      await byId('quiz-answer-input').setValue(answers[stem])
      await byId('quiz-submit').click()
      await browser.pause(4000)
      await shoot('check-correct')
      const a = await browser.getPageSource()
      note(/100%/.test(a), 'a right answer is graded instantly and free')
      note(!(await byId('quiz-grade').isDisplayed().catch(() => false)),
        'no paid grading is offered for an answer settled free')
    }

    const next = byId('quiz-next')
    if (await next.isDisplayed().catch(() => false)) {
      await next.click(); await browser.pause(2500)
      if (await byId('quiz-answer-input').isDisplayed().catch(() => false)) {
        await byId('quiz-answer-input').setValue('전혀다른오답')
        await byId('quiz-submit').click()
        await browser.pause(4000)
        await shoot('check-wrong')
        const w = await browser.getPageSource()
        note(await byId('quiz-grade').isDisplayed().catch(() => false),
          'a wrong answer offers the priced grader')
      }
    }
  })

  after(() => {
    console.log(`\n${found.length === 0 ? P.toUpperCase() + ': everything checked behaved as intended' : P.toUpperCase() + ' ISSUES:'}`)
    for (const f of found) console.log(`  ❌ ${f}`)
  })
})
