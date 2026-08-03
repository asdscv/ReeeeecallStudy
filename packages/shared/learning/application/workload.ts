// ─── How much work a goal actually costs, before the learner commits to it ───
//
// The goal form used to ask "하루 몇 분?" and the learner had to guess. They cannot know: the
// answer depends on how many cards are unseen and how far away the target date is, and the app
// knows both. So the question is inverted — the learner gives decks and a date, and this module
// answers with the daily cost.
//
// WHY A FLOW MODEL AND NOT A FULL SIMULATION. A faithful card-by-card run of `lib/srs.ts` over
// 10,000 cards is accurate but takes seconds, and this recomputes while a date field changes.
// Tracking COUNTS of cards at each ladder rung instead costs one pass over (days x rungs) and
// reproduces the same numbers — validated against that card-level simulation, which is the only
// reason to trust it.
//
// WHY THE PEAK IS REPORTED, NOT JUST THE AVERAGE. Because the average is a comfortable lie: in
// the reference run (5,000 cards, 60 new/day) the mean is ~9 minutes a day and the busiest day
// is ~88. A learner who agreed to "9분" and met 88 would be right to feel misled. Review load
// piles up behind the intake, so the honest number to show is the top of that pile.
import { validationError } from '../domain/errors.ts'

/**
 * Interval in days granted by each successive correct review, from the all-correct path of
 * `packages/shared/lib/srs.ts` under default settings: 1, 3, 8, 21, 56, 151, then the
 * `max_interval_days` ceiling.
 *
 * Taken from the shipped scheduler rather than assumed. Ease rises +0.05 per correct answer, so
 * the ratios are not a clean geometric series and a guessed one would drift.
 */
export const INTERVALS_DAYS: readonly number[] = [1, 3, 8, 21, 56, 151, 365]

/**
 * `learning_steps` from `DEFAULT_SRS_SETTINGS` — two steps, 1 and 10 minutes.
 *
 * Both fall on the intake day, which is why entering the learning phase costs several answers
 * but no calendar time.
 */
const LEARNING_STEPS = 2

/**
 * Answers consumed each time a card enters the learning phase, including retries.
 *
 * A card does not graduate in one answer: it must pass every learning step, and a wrong answer
 * sends it back to the FIRST step, not the previous one (`calculateLearning`, case 'again'). At
 * a 20% learning-phase error rate two steps cost ~2.8 answers, not 2 — and this is paid again on
 * every lapse, because a lapsed review card re-enters learning at step 0.
 *
 * Counting it as a single answer is what made the first two versions of this model 26-38% low.
 * Solved as a recurrence rather than tabulated so it stays correct if `learning_steps` changes:
 *   E[i] = 1 + p*E[0] + (1-p)*E[i+1],  E[steps] = 0
 */
export function learningAnswers(steps: number, errorRate: number): number {
  if (steps <= 0) return 0
  const p = Math.min(Math.max(errorRate, 0), 0.95)
  // E[0] appears on both sides, so solve for it: expand E[0] = a + b*E[0].
  let a = 0, b = 0            // E[i] = a + b*E[0], walked back from the graduating step
  for (let i = steps - 1; i >= 0; i -= 1) {
    a = 1 + (1 - p) * a
    b = p + (1 - p) * b
  }
  return b >= 1 ? Number.POSITIVE_INFINITY : a / (1 - b)
}

/**
 * Error rate while a card is in the learning phase.
 *
 * Higher than the review-phase rate: these are cards seen minutes ago for the first time, not
 * ones that survived to a multi-day interval. Twice the review rate reproduces the card-level
 * simulation; capped so a pathological input cannot make the recurrence diverge.
 */
function learningErrorRate(lapseRate: number): number {
  return Math.min(lapseRate * 2, 0.35)
}

// Not exported until a screen names it — `learning-kernel-no-dead-exports.test.ts` fails an
// export nothing reads, and callers pass object literals today.
interface WorkloadRequest {
  /** Cards in the goal's decks that the learner has never seen. Drives intake. */
  readonly unseenCards: number
  /** Cards already in the schedule. They generate reviews without needing intake. */
  readonly seenCards: number
  /** Days from today until the target date. */
  readonly daysAvailable: number
  /** Median seconds to answer one card. Measured per learner where known. */
  readonly secondsPerCard: number
  /** Share of reviews answered wrong. 0.10 is the SRS-community norm for a healthy deck. */
  readonly lapseRate: number
  /**
   * Days before the target date to stop introducing new cards.
   *
   * A card first seen the day before an exam has had no chance to consolidate; the tail is spent
   * letting what is already in the schedule settle. This is what RemNote calls a consolidation
   * period, and the simulation only reached 10,000/10,000 with one.
   */
  readonly consolidationDays: number
}

interface WorkloadProjection {
  /** New cards to introduce each day to finish intake before consolidation begins. */
  readonly newCardsPerDay: number
  readonly averageMinutesPerDay: number
  readonly peakMinutesPerDay: number
  /** Days from today when the peak lands, so the estimate can say WHEN, not just how much. */
  readonly peakDay: number
  readonly totalHours: number
  /** Minutes per day, indexed by day offset — for a chart rather than three numbers. */
  readonly dailyMinutes: readonly number[]
}

/**
 * Reviews falling on each day, as a flow of cards over ladder positions.
 *
 * Not a per-card simulation and not a fixed ladder. Cards are tracked as fractional COUNTS at
 * each rung, so one pass over (days x rungs) reproduces what a card-by-card run of the real
 * scheduler produces, in microseconds — a form that recomputes while a date field changes cannot
 * afford seconds.
 *
 * Lapses are modelled, not fudged. A first attempt multiplied the all-correct ladder by
 * `1 + 4 * lapseRate` and came out 26-38% LOW against a card-level simulation of `lib/srs.ts`,
 * with the busiest day landing a month early — because a lapse does not add a few reviews, it
 * sends the card back to rung zero to climb the whole ladder again. Here each due card splits:
 * `1 - lapseRate` advances a rung, `lapseRate` returns to the bottom. The cost of forgetting
 * then falls out of the arithmetic instead of being guessed at.
 */
function dailyReviewCounts(input: WorkloadRequest, newPerDay: number, intakeDays: number): number[] {
  const days = input.daysAvailable
  const rungs = INTERVALS_DAYS.length
  // Every entry into the learning phase — at intake, and again after each lapse — costs this
  // many answers before the card is back on the ladder.
  const entryCost = learningAnswers(LEARNING_STEPS, learningErrorRate(input.lapseRate))
  // due[day][rung] — cards due on `day` that will be granted INTERVALS_DAYS[rung] if correct.
  const due: number[][] = Array.from({ length: days + 1 }, () => new Array<number>(rungs).fill(0))
  const counts = new Array<number>(days).fill(0)

  // Cards already in the schedule start spread across the ladder. Uniform because asking the
  // caller for a per-card interval histogram would buy precision the seconds-per-card figure
  // cannot support — and without them, a goal over an already-studied deck would report no work.
  if (input.seenCards > 0) {
    const perRung = input.seenCards / rungs
    for (let rung = 0; rung < rungs; rung += 1) {
      // Spread each rung's cards evenly across its own interval, so nothing piles onto day 0.
      const span = Math.min(INTERVALS_DAYS[rung], days)
      for (let offset = 0; offset < span; offset += 1) {
        due[offset][rung] += perRung / span
      }
    }
  }

  for (let day = 0; day < days; day += 1) {
    let reviews = 0

    // Intake: the learning steps are minutes apart, so a new card is answered on its intake day
    // and lands on rung 0 tomorrow.
    if (day < intakeDays && newPerDay > 0) {
      reviews += newPerDay * entryCost
      if (day + INTERVALS_DAYS[0] <= days) due[day + INTERVALS_DAYS[0]][0] += newPerDay
    }

    for (let rung = 0; rung < rungs; rung += 1) {
      const arriving = due[day][rung]
      if (arriving <= 0) continue
      reviews += arriving

      const passed = arriving * (1 - input.lapseRate)
      const lapsed = arriving * input.lapseRate

      // Correct: move up a rung, or stay on the ceiling rung once there.
      const nextRung = Math.min(rung + 1, rungs - 1)
      const nextDay = day + INTERVALS_DAYS[nextRung]
      if (nextDay <= days) due[nextDay][nextRung] += passed

      // Wrong: relearn today, then start the climb again from the bottom tomorrow. The extra
      // relearning answer is counted here because the learner really does see the card twice.
      if (lapsed > 0) {
        reviews += lapsed * entryCost
        const backDay = day + INTERVALS_DAYS[0]
        if (backDay <= days) due[backDay][0] += lapsed
      }
    }

    counts[day] = reviews
  }
  return counts
}

export function projectWorkload(input: WorkloadRequest): WorkloadProjection {
  if (!Number.isFinite(input.daysAvailable) || input.daysAvailable <= 0) {
    throw validationError('daysAvailable must be positive', { daysAvailable: input.daysAvailable })
  }
  if (!Number.isFinite(input.secondsPerCard) || input.secondsPerCard <= 0) {
    throw validationError('secondsPerCard must be positive', { secondsPerCard: input.secondsPerCard })
  }
  if (!Number.isFinite(input.lapseRate) || input.lapseRate < 0 || input.lapseRate >= 1) {
    throw validationError('lapseRate must be in [0, 1)', { lapseRate: input.lapseRate })
  }

  // Intake has to finish before consolidation starts, but a date so close that consolidation
  // would consume the whole window still gets at least one day to introduce cards — otherwise a
  // learner with a week to go is told the plan is impossible instead of being told it is hard.
  const intakeDays = Math.max(1, input.daysAvailable - Math.max(0, input.consolidationDays))
  const newPerDay = input.unseenCards > 0 ? Math.ceil(input.unseenCards / intakeDays) : 0

  // Lapse cost is inside `dailyReviewCounts` now, so nothing is applied on top of it here.
  const counts = dailyReviewCounts(input, newPerDay, intakeDays)
  const dailyMinutes = counts.map((reviews) => (reviews * input.secondsPerCard) / 60)

  let peak = 0, peakDay = 0, total = 0
  dailyMinutes.forEach((minutes, day) => {
    total += minutes
    if (minutes > peak) { peak = minutes; peakDay = day }
  })

  return {
    newCardsPerDay: newPerDay,
    averageMinutesPerDay: total / dailyMinutes.length,
    peakMinutesPerDay: peak,
    peakDay,
    totalHours: total / 60,
    dailyMinutes,
  }
}

/**
 * The date at which a given daily budget finishes intake — the inverse question.
 *
 * The confirmation screen lets the learner pin either side: "I have 30 minutes a day, when am I
 * done?" is as legitimate as "I have until November, how long per day?". Returns the number of
 * days needed, or null when the budget cannot even keep up with the reviews the existing cards
 * already generate — in which case no date is reachable and saying so beats returning a number.
 */
export function daysForDailyBudget(
  input: Omit<WorkloadRequest, 'daysAvailable'> & { readonly minutesPerDay: number },
): number | null {
  if (!Number.isFinite(input.minutesPerDay) || input.minutesPerDay <= 0) {
    throw validationError('minutesPerDay must be positive', { minutesPerDay: input.minutesPerDay })
  }
  // Bisect on days rather than solving analytically: the ladder makes load non-monotonic within
  // a window, and the peak is what has to fit, so an exact inverse would be fragile.
  let low = 1, high = 4000, answer: number | null = null
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const projection = projectWorkload({ ...input, daysAvailable: mid })
    if (projection.peakMinutesPerDay <= input.minutesPerDay) { answer = mid; high = mid - 1 }
    else low = mid + 1
  }
  return answer
}

/**
 * How many reviews a batch of newly-started cards adds to TOMORROW.
 *
 * All of them, and this is the honest thing to tell a learner pressing "더 하기": the first
 * rung of the ladder is one day, so every card started today comes back tomorrow. Not "about
 * seven reviews over a year" — true, but not a number anyone can act on tonight.
 *
 * Derived from {@link INTERVALS_DAYS} rather than written as `n`, so it stays correct if the
 * scheduler's first interval ever stops being one day: a first rung of 3 days would mean these
 * cards land three days out, and tomorrow's answer becomes zero.
 */
export function reviewsAddedTomorrow(newCards: number): number {
  if (!Number.isFinite(newCards) || newCards <= 0) return 0
  return INTERVALS_DAYS[0] === 1 ? Math.floor(newCards) : 0
}
