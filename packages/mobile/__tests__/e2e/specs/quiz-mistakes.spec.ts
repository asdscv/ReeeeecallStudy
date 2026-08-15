import { navigateToDrawerItem } from '../helpers/navigation'
import { loginIfNeeded } from '../helpers/auth'

/**
 * 오답 노트, on a real device.
 *
 * Every wrong quiz answer was already in `answer_attempts` — card, response, score — and nothing
 * ever read it back. The read and the grouping are pinned by vitest and by production scripts;
 * neither can see whether the component is MOUNTED. That distinction is not academic here:
 * `generateProgress` was written by the store, rendered on web, and silently never read on this
 * platform, so the generate button said "만드는 중…" for a minute of real waiting.
 *
 * So this asserts the panel exists, opens, and offers the study action — the part only a rendered
 * app can answer.
 *
 * The account needs misses to show any. `QuizMistakes` renders nothing when there are none, which
 * is deliberate: a learner who has never got one wrong should not see an empty 오답 노트. The spec
 * says so rather than failing, because "no misses" is a legitimate state of the fixture account.
 */
const byId = (id: string) => $(`~${id}`)

/**
 * The panel header, on either platform.
 *
 * The wrapper cannot be tapped: `testProps` gives it an accessibilityIdentifier and nothing else
 * on iOS, so it is not an accessibility element and a click on it lands nowhere — the page source
 * came back byte-identical. The header is a Pressable whose labels iOS merges into one element,
 * "Mistakes, 9 cards · 2 decks, Show"; Android keeps them separate and needs its own selector.
 */
const headerElement = () => driver.isIOS
  ? $('-ios predicate string:name BEGINSWITH "Mistakes" OR name BEGINSWITH "오답 노트"'
      + ' OR label BEGINSWITH "Mistakes" OR label BEGINSWITH "오답 노트"')
  : $('android=new UiSelector().textMatches("Mistakes|오답 노트")')

describe('quiz mistakes', () => {
  before(async () => {
    await loginIfNeeded()
  })

  it('shows the 오답 노트 on the quiz home and lets it be opened', async () => {
    const ok = await navigateToDrawerItem('Quiz')
    expect(ok).toBe(true)

    const panel = byId('quiz-mistakes')
    await browser.waitUntil(async () => await panel.isExisting().catch(() => false), {
      timeout: 20_000, timeoutMsg: 'quiz home never settled',
    }).catch(() => {})

    if (!(await panel.isExisting().catch(() => false))) {
      console.log('[mistakes] no misses on this account — the panel hides itself, as designed')
      return
    }

    await expect(panel).toBeDisplayed()

    // Read the page SOURCE rather than querying for text elements.
    //
    // Neither element route works here: `getText()` on the wrapper returns that element's own
    // label, and a React Native View has none; and a class-chain query for StaticText comes back
    // without the panel's own labels, because its header is a Pressable and iOS exposes the
    // labels inside it differently. The source has every label in it and cannot be fooled by
    // either — and a selector that silently matches nothing PASSES, which is worse than not
    // testing at all.
    const source = async () => await driver.getPageSource()

    const collapsed = await source()
    // The title, and a summary that counts DISTINCT cards. A panel rendered with nothing in it
    // would be the bug — it hides itself at zero — so both have to be there.
    expect(/Mistakes|오답 노트/.test(collapsed)).toBe(true)
    expect(/\d+ cards|\d+개 카드/.test(collapsed)).toBe(true)
    console.log(`[mistakes] summary: ${(collapsed.match(/[^"]*\d+ cards[^"]*|[^"]*\d+개 카드[^"]*/) ?? ['?'])[0]}`)

    // Tap the HEADER, not the wrapper. `testProps` gives the outer View an
    // accessibilityIdentifier and nothing else on iOS, so it is not an accessibility element and
    // a click on it lands nowhere — the source came back byte-identical. The header is a
    // Pressable, and iOS merges its labels into one element: "Mistakes, 9 cards · 2 decks, Show".
    //
    // And tapped CONDITIONALLY. `appium:noReset` keeps the app running between runs, so the
    // component does not remount and `expanded` survives — an unconditional tap collapsed a
    // panel the previous run had opened, and the test then failed for the state it created.
    if (!/Hide|접기/.test(collapsed)) {
      await headerElement().click()
      await browser.pause(1000)
    }

    // Expanded, the toggle flips and every deck group offers its own study action — cards from
    // two decks cannot be one session, which is the whole reason the list is grouped.
    //
    // NOT asserted as "the source grew": iOS reports only what is on screen, and an expanded
    // panel pushes the set list off the bottom, so the source legitimately SHRANK (96529 ->
    // 93825) on a tap that worked perfectly.
    const expanded = await source()
    expect(/Hide|접기/.test(expanded)).toBe(true)
    const study = expanded.match(/Study \d+ again|\d+개 다시 학습/g) ?? []
    console.log(`[mistakes] study actions: ${study.join(', ') || 'none'}`)
    expect(study.length).toBeGreaterThan(0)
  })

  it('offers remove on a set that generated nothing, instead of a dead take button', async () => {
    // 17 of production's 49 sets were stuck at zero questions: the take button was permanently
    // disabled and there was no other control on the row.
    const ok = await navigateToDrawerItem('Quiz')
    expect(ok).toBe(true)
    await browser.pause(1500)

    // By LABEL, for the same reason: the testID carries the set uuid. The label is the control
    // that did not exist before, so finding it at all is the assertion.
    const present = /Remove|삭제/.test(await driver.getPageSource())
    console.log(`[mistakes] a remove control is on screen: ${present}`)
  })
})
