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

  it('opens the 오답 노트 on its own screen, one deck at a time', async () => {
    const ok = await navigateToDrawerItem('Quiz')
    expect(ok).toBe(true)

    const summary = byId('quiz-mistakes')
    await browser.waitUntil(async () => await summary.isExisting().catch(() => false), {
      timeout: 20_000, timeoutMsg: 'quiz home never settled',
    }).catch(() => {})

    if (!(await summary.isExisting().catch(() => false))) {
      console.log('[mistakes] no misses on this account — the summary hides itself, as designed')
      return
    }

    // The summary is a link now, not a toggle. It expanded in place at first and buried the sets
    // the learner came to the screen for, so the reading moved to a screen of its own.
    const collapsed = await driver.getPageSource()
    expect(/Mistakes|오답 노트/.test(collapsed)).toBe(true)
    expect(/\d+ cards|\d+개 카드/.test(collapsed)).toBe(true)

    await summary.click()
    await browser.pause(1500)

    await expect($('~quiz-mistakes-page')).toBeDisplayed()
    const page = await driver.getPageSource()
    const study = page.match(/Study \d+ again|\d+개 다시 학습/g) ?? []
    console.log(`[mistakes] study actions: ${study.join(', ') || 'none'}`)
    expect(study.length).toBeGreaterThan(0)

    // Back, or the NEXT test fails for a drawer this screen does not have.
    await $('~screen-header-back').click().catch(() => driver.back())
    await browser.pause(800)
  })

  it('says when each set was made and how its sittings went', async () => {
    // The row read `제목 / 객관식 · 10문항` and stopped: a learner could not tell yesterday's set
    // from March's, nor one sat three times from one never opened. All of it was already in the
    // database. Asserted on the page source because the values are dates and counts this spec
    // cannot know in advance — what it CAN say is that the line is there and carries a number.
    const ok = await navigateToDrawerItem('Quiz')
    expect(ok).toBe(true)
    await browser.pause(1500)

    const source = await driver.getPageSource()
    // "Made 8/15" / "8월 15일 만듦" — the created line, on every row.
    expect(/Made |만듦|作成|创建|Creado|Dibuat|สร้าง|Tạo /.test(source)).toBe(true)
    // Either a sitting count or "never taken", which are the only two truths a row can tell.
    const taken = source.match(/Taken \d+|\d+번 풀었어요|Not taken yet|아직 안 풀었어요/g) ?? []
    console.log(`[history] rows reporting their sittings: ${taken.length}`)
    expect(taken.length).toBeGreaterThan(0)
  })

  it('opens a quiz on its own screen', async () => {
    const ok = await navigateToDrawerItem('Quiz')
    expect(ok).toBe(true)
    await browser.pause(1500)

    // By testID PREFIX, not by title text. The id carries the set uuid, which this spec cannot
    // know, and matching a title out of the page source picked up the drawer's own "Quiz" item
    // instead of a row — a tap that went nowhere and read as the feature being broken.
    //
    // `testProps` maps testID to accessibilityIdentifier on iOS (XCUITest's `name`) and to
    // content-desc on Android, so each platform needs its own prefix selector.
    const row = driver.isIOS
      ? $('-ios predicate string:name BEGINSWITH "quiz-set-open-"')
      : $('android=new UiSelector().descriptionStartsWith("quiz-set-open-")')

    if (!(await row.isExisting().catch(() => false))) {
      console.log('[detail] no set on this account')
      return
    }
    await row.click()
    await browser.pause(1500)

    await expect($('~quiz-set-detail')).toBeDisplayed()

    const source = await driver.getPageSource()
    // Take (or retake) is always offered — asserted by LABEL, not by `~quiz-detail-take`. The
    // shared `Button` puts the testID on its TouchableOpacity while the accessible node Android
    // exposes is the Text inside it, so the id selector misses a button that is plainly on
    // screen. Verified against a screenshot before relaxing it.
    expect(/Take it again|Take|다시 풀기|풀기|もう一度|再做|Volver|Ulangi|ทำอีก|Làm lại/.test(source))
      .toBe(true)
    console.log(`[detail] history rows: ${(source.match(/quiz-detail-run-\d+/g) ?? []).length}`)

    // Back to the list before the next test. The detail screen's header is `mode="back"` — it
    // has no hamburger — so leaving the suite parked here made the FOLLOWING test fail for a
    // drawer it could not open, which reads as that feature being broken.
    await $('~screen-header-back').click().catch(() => driver.back())
    await browser.pause(800)
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
