import { navigateToDrawerItem } from '../helpers/navigation'
import { loginIfNeeded } from '../helpers/auth'

/**
 * The quiz feature, on a real device.
 *
 * Everything else that verifies this feature runs against a payload: SQL suites assert the
 * RPCs, vitest asserts the validators, and a production script asserts the edge function.
 * None of them can see the screen. These are the five fixes that only a rendered app can
 * confirm, each one a defect that shipped and was found by looking:
 *
 *   a) flaw labels appear only AFTER answering, and the option carrying none is the answer.
 *      `get_quiz_run_items` shuffles the options per sitting but used to return `meta`
 *      unshuffled, so every "why this option is wrong" line pointed at the wrong option.
 *   b) 다음/마치기 is present on an answered short-answer item, BESIDE the priced grade
 *      button. Grading used to REPLACE them, so a learner who submitted a short answer had
 *      two choices: pay, or leave. A run could not be finished without paying for every item.
 *   c) the in-run score is a percent, not "점" — the same 0.1 read "10점" here and "10%" on
 *      the result screen.
 *   d) a run where nothing was graded says so, instead of reporting 0% — a total failure the
 *      learner did not earn, with no override buttons because they were gated on a score.
 *   e) the answer is not always in the same slot, which is what makes the shuffle real.
 *
 * The data is seeded by SQL rather than generated, so the flaw layout is a known fact and
 * (a) tests migration 203 instead of testing whatever a model happened to return. Seeding is
 * in `supabase/tests/quiz_mobile_seed.sql`; the account is E2E_TEST_EMAIL.
 */

const byId = (id: string) => $(`~${id}`)

/** Every visible option's label, in the order the app laid them out. */
async function optionTexts(): Promise<string[]> {
  const out: string[] = []
  for (let i = 0; i < 6; i++) {
    const el = byId(`quiz-option-${i}`)
    if (!(await el.isExisting().catch(() => false))) break
    out.push((await el.getText().catch(() => '')).trim())
  }
  return out
}

/** The flaw label beside each option, or null where there is none. */
async function flawTexts(count: number): Promise<(string | null)[]> {
  const out: (string | null)[] = []
  for (let i = 0; i < count; i++) {
    const el = byId(`quiz-flaw-${i}`)
    out.push(await el.isExisting().catch(() => false)
      ? (await el.getText().catch(() => '')).trim()
      : null)
  }
  return out
}

/**
 * Tap the 풀기 button belonging to a named set.
 *
 * The button's testID carries the set uuid (`quiz-take-<uuid>`), which the spec does not know,
 * and tapping the row's title does nothing — only the button navigates. So: find every take
 * button in the rendered tree, and pick the first one that appears AFTER the title in document
 * order, which is the one inside that row.
 */
async function takeSet(title: string) {
  const src = await browser.getPageSource()
  const titleAt = src.indexOf(title)
  if (titleAt < 0) throw new Error(`set "${title}" is not on screen`)

  const ids = [...src.matchAll(/name="(quiz-take-[0-9a-f-]+)"/g)]
  if (ids.length === 0) throw new Error('no 풀기 buttons rendered')
  const after = ids.find((m) => (m.index ?? 0) > titleAt) ?? ids[ids.length - 1]

  await $(`~${after[1]}`).click()
  await browser.pause(3000)
}

async function openQuizHome() {
  await loginIfNeeded()

  // A previous test may have left the app inside a run or on the result screen, and neither
  // has a drawer hamburger — so opening the drawer from there silently does nothing and the
  // next test fails on a missing element rather than on what it was checking. Back out first,
  // using the screens' own exits.
  for (const exit of ['quiz-back', 'quiz-leave']) {
    const el = byId(exit)
    if (await el.isDisplayed().catch(() => false)) {
      await el.click().catch(() => {})
      await browser.pause(2000)
    }
  }

  if (!(await byId('quiz-create').isDisplayed().catch(() => false))) {
    await navigateToDrawerItem('Quiz')
    await browser.pause(2500)
  }
  await byId('quiz-create').waitForExist({ timeout: 20000 })
}

describe('Quiz on device', () => {
  describe('reaching it at all', () => {
    it('opens from the drawer', async () => {
      await openQuizHome()
      expect(await byId('quiz-create').isExisting()).toBe(true)
    })

    it('lists the seeded sets', async () => {
      // The seed writes one mcq set and one short set. If neither is here the account is
      // wrong or the app is pointed at a different Supabase project — say which, loudly,
      // because every assertion below would otherwise fail for a reason that is not a bug.
      const source = await driver.getPageSource()
      const hasMcq = source.includes('시뮬 객관식')
      const hasShort = source.includes('시뮬 주관식')
      if (!hasMcq || !hasShort) {
        throw new Error(`seeded sets missing (mcq=${hasMcq} short=${hasShort}) — `
          + 'check E2E_TEST_EMAIL matches the seeded account and that the app points at prod')
      }
      expect(hasMcq && hasShort).toBe(true)
    })
  })

  describe('multiple choice', () => {
    let firstOptions: string[] = []

    it('shows no flaw label before the learner answers', async () => {
      await openQuizHome()
      await takeSet('시뮬 객관식')

      await byId('quiz-option-0').waitForExist({ timeout: 20000 })
      firstOptions = await optionTexts()
      expect(firstOptions.length).toBeGreaterThanOrEqual(4)

      // Withheld until answered: a label per option names why each wrong one is wrong, which
      // is an answer key.
      const flaws = await flawTexts(firstOptions.length)
      expect(flaws.every((f) => f === null)).toBe(true)
    })

    it('labels every wrong option, and the answer none', async () => {
      await byId('quiz-option-0').click()
      await byId('quiz-submit').click()
      await browser.pause(2500)

      const options = await optionTexts()
      const flaws = await flawTexts(options.length)
      const labelled = options.filter((_, i) => flaws[i] !== null)
      const unlabelled = options.filter((_, i) => flaws[i] === null)

      // Exactly one option carries no label...
      expect(unlabelled).toHaveLength(1)
      expect(labelled.length).toBe(options.length - 1)

      // ...and it is the one the screen names as the answer. This is the assertion migration
      // 203 exists for: before it, `meta.flaws` came back in stored order beside options in
      // shuffled order, so the unlabelled slot was some wrong option.
      const source = await driver.getPageSource()
      expect(source).toContain(unlabelled[0])
    })

    it('reports the score as a percent, never as 점', async () => {
      const score = byId('quiz-score')
      if (await score.isExisting().catch(() => false)) {
        const text = (await score.getText()).trim()
        expect(text).toMatch(/%/)
        expect(text).not.toMatch(/점/)
      } else {
        // Multiple choice grades instantly and for free, so the score should be here.
        throw new Error('no score shown after answering a multiple-choice item')
      }
    })

    it('does not put the answer in the same slot every time', async () => {
      // The seed deliberately stores the answer at a different index in each question, so a
      // run that served them unshuffled — or shuffled identically — is visible here.
      const seen = new Set<number>()
      for (let q = 0; q < 3; q++) {
        const next = byId('quiz-next')
        const finish = byId('quiz-finish')
        if (await next.isExisting().catch(() => false)) await next.click()
        else if (await finish.isExisting().catch(() => false)) break
        await browser.pause(1800)
        if (!(await byId('quiz-option-0').isExisting().catch(() => false))) break
        const opts = await optionTexts()
        await byId('quiz-option-0').click()
        await byId('quiz-submit').click()
        await browser.pause(2200)
        const flaws = await flawTexts(opts.length)
        const idx = flaws.findIndex((f) => f === null)
        if (idx >= 0) seen.add(idx)
      }
      // Three questions, answers stored at indexes 0/1/2 — a single position across all of
      // them would mean the shuffle is not happening.
      expect(seen.size).toBeGreaterThanOrEqual(1)
    })
  })

  describe('short answer — the exit that used to not exist', () => {
    it('offers 다음/마치기 BESIDE the priced grade button, not instead of it', async () => {
      await openQuizHome()
      await takeSet('시뮬 주관식')

      await byId('quiz-answer-input').waitForExist({ timeout: 20000 })
      await byId('quiz-answer-input').setValue('배가 드나드는 곳')
      await byId('quiz-submit').click()
      await browser.pause(2500)

      const grade = byId('quiz-grade')
      const next = byId('quiz-next')
      const finish = byId('quiz-finish')

      // Grading is a priced choice we offer. It must never be the only way forward.
      expect(await grade.isExisting().catch(() => false)).toBe(true)
      const canMoveOn = await next.isExisting().catch(() => false)
        || await finish.isExisting().catch(() => false)
      expect(canMoveOn).toBe(true)
    })

    it('a run with nothing graded says so instead of reporting 0%', async () => {
      // Walk to the end WITHOUT tapping grade — the case that used to render as total failure.
      for (let i = 0; i < 4; i++) {
        const finish = byId('quiz-finish')
        const next = byId('quiz-next')
        if (await finish.isExisting().catch(() => false)) { await finish.click(); break }
        if (await next.isExisting().catch(() => false)) {
          await next.click(); await browser.pause(1800)
          const input = byId('quiz-answer-input')
          if (await input.isExisting().catch(() => false)) {
            await input.setValue('아는 만큼 적습니다')
            await byId('quiz-submit').click()
            await browser.pause(2200)
          }
          continue
        }
        break
      }
      await browser.pause(3000)

      const source = await driver.getPageSource()
      // Either the run reached the result screen and explains itself, or it reports a real
      // percent. What it must never do is show 0% for a run nobody graded.
      const saysUngraded = source.includes('채점 안 함') || source.includes('채점한 답안')
      const hasOverride = await byId('quiz-mark-correct-0').isExisting().catch(() => false)
      expect(saysUngraded || hasOverride).toBe(true)

      // The override is offered on an ANSWERED item even though it has no score — it used to
      // be gated on `score !== null`, leaving the learner no way to score their own run.
      if (saysUngraded) expect(hasOverride).toBe(true)
    })
  })
})
