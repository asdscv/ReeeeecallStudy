import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { useNavigation, type NavigationProp } from '@react-navigation/native'
import { Screen, ScreenHeader } from '../components/ui'
import { useTheme } from '../theme'
import type { SettingsStackParamList } from '../navigation/types'
import { testProps } from '../utils/testProps'
import {
  availableDomainIds, projectWorkload, daysForDailyBudget, studyDaysBetween,
  perStudyDayMultiplier, DEFAULT_NEW_CARDS_PER_DAY,
} from '@reeeeecall/shared/learning'
import { useLearningStore } from '@reeeeecall/shared/stores/learning-store'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'
import { useAuthStore } from '@reeeeecall/shared/stores/auth-store'

/**
 * Goals — mobile parity with the web `/learning/goals` screen.
 *
 * Client-side validation mirrors the RPC's own bounds (title 1–500, daily minutes 1–1440)
 * so the common mistakes never become a round-trip; the server stays the authority and its
 * errors are still rendered.
 *
 * The domain is a fixed choice, not free text: `domain_id` selects a registered adapter, and
 * a typo would create a goal no adapter can plan for. Archived goals are not listed — the
 * RPCs reject them, so listing one would only offer dead actions.
 */
/**
 * Horizons offered instead of a calendar.
 *
 * A native date picker would mean `@react-native-community/datetimepicker`, and a new native
 * dependency turns every release into a store rebuild rather than an OTA update. It is also the
 * worse control here: someone preparing for an exam thinks in "three months", not in a date.
 */
const HORIZONS_MONTHS = [1, 3, 6, 12] as const

/** Which side of the same question the learner pinned — mirrors the web form's `basis`. */
type PlanBasis = 'date' | 'minutes'

/** The rhythms offered. Same 1..7 range the web select has, as chips. */
const STUDY_DAY_CHOICES = [1, 2, 3, 4, 5, 6, 7] as const

/** Neutral weight for every deck, now that the learner is not asked to rank them. */
const NEUTRAL_IMPORTANCE = 0.5
const CONSOLIDATION_DAYS = 14
const ASSUMED_SECONDS_PER_CARD = 8
const ASSUMED_LAPSE_RATE = 0.10
const DAY_MS = 86_400_000

const MIN_TOUCH = 44
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const

export function LearningGoalsScreen() {
  const { t } = useTranslation('learning')
  const theme = useTheme()
  const navigation = useNavigation<NavigationProp<SettingsStackParamList>>()
  const {
    goals, goalsLoading, goalsError, fetchGoals, createGoal, archiveGoal, deleteGoal,
    archivedGoals, archivedGoalsLoading, fetchArchivedGoals, restoreGoal,
  } = useLearningStore()
  const { decks, stats, fetchDecks, fetchStats } = useDeckStore()
  const userId = useAuthStore((state) => state.user?.id)

  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [title, setTitle] = useState('')
  const [horizonMonths, setHorizonMonths] = useState<number | null>(null)
  const [deckIds, setDeckIds] = useState<Set<string>>(new Set())
  const [localError, setLocalError] = useState<string | null>(null)
  // The learner pins ONE side — a horizon, or a daily budget — and the app answers the other.
  // Two live inputs both feeding the saved budget is how the web form ended up showing two
  // different finish stories at once, so mobile states the choice instead of inferring it.
  const [basis, setBasis] = useState<PlanBasis>('date')
  const [budgetMinutes, setBudgetMinutes] = useState<number | null>(null)
  /** How often they study, `studyDays` out of 7. Was hardcoded to every day with no control. */
  const [studyDays, setStudyDays] = useState(7)
  /**
   * New cards to start per study day. Mobile had no control at all, so every goal created on a
   * phone planned UNCAPPED — `parseNewCardsPerDay` reads a missing value as no limit.
   */
  const [newCardsPerDay, setNewCardsPerDay] = useState(DEFAULT_NEW_CARDS_PER_DAY)

  useEffect(() => { void fetchGoals() }, [fetchGoals])
  useEffect(() => { if (creating) void fetchDecks() }, [creating, fetchDecks])
  useEffect(() => { if (creating && userId) void fetchStats(userId) }, [creating, userId, fetchStats])

  // `get_deck_stats` already splits cards by SRS state and covers subscribed decks, so the
  // preview sizes itself from real counts rather than treating a studied deck as untouched.
  const selection = useMemo(() => {
    let unseen = 0, seen = 0
    for (const row of stats) {
      if (!deckIds.has(row.deck_id)) continue
      unseen += row.new_cards
      seen += row.review_cards + row.learning_cards
    }
    return { unseen, seen, total: unseen + seen }
  }, [stats, deckIds])

  const daysAvailable = horizonMonths === null ? null : Math.round(horizonMonths * 30.44)

  /** `studyDays` out of every 7. The cycle stays 7 until there is a control for it. */
  const cadence = useMemo(() => ({ cycleDays: 7, studyDays }), [studyDays])

  const workloadInput = {
    unseenCards: selection.unseen,
    seenCards: selection.seen,
    secondsPerCard: ASSUMED_SECONDS_PER_CARD,
    lapseRate: ASSUMED_LAPSE_RATE,
    consolidationDays: CONSOLIDATION_DAYS,
  }

  /**
   * The projection runs over CALENDAR days because that is when reviews come due; studying fewer
   * days does not reduce the work, it concentrates it. So the per-day figures are scaled up by
   * the inverse of the study ratio afterwards rather than the horizon being shortened first.
   */
  const projection = useMemo(() => {
    if (selection.total === 0 || daysAvailable === null) return null
    if (studyDaysBetween(cadence, daysAvailable) < 1) return null
    const raw = projectWorkload({ ...workloadInput, daysAvailable })
    const perDay = perStudyDayMultiplier(cadence)
    return {
      ...raw,
      averageMinutesPerDay: raw.averageMinutesPerDay * perDay,
      peakMinutesPerDay: raw.peakMinutesPerDay * perDay,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.unseen, selection.seen, selection.total, daysAvailable, cadence])

  /** Budget-driven: when it finishes. Null when the budget cannot keep up at all. */
  const daysForBudget = useMemo(() => {
    if (selection.total === 0 || budgetMinutes === null || budgetMinutes <= 0) return null
    // The budget is what the learner does IN A SESSION, so spread it back over calendar days
    // before asking how long it takes — otherwise a three-days-a-week learner is told the
    // finish date of someone studying daily.
    return daysForDailyBudget({
      ...workloadInput,
      minutesPerDay: budgetMinutes / perStudyDayMultiplier(cadence),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.unseen, selection.seen, selection.total, budgetMinutes, cadence])

  const budgetFinishDate = daysForBudget === null
    ? null
    : new Date(Date.now() + daysForBudget * DAY_MS).toISOString().slice(0, 10)

  /**
   * The intake rate the horizon demands, against the ceiling the learner set. Same unit, two
   * different meanings — so when the ceiling is the lower of the two, the form says so instead
   * of showing both numbers and letting them quietly disagree.
   */
  const neededNewPerDay = projection?.newCardsPerDay ?? null
  const capBlocksTarget =
    basis === 'date' && neededNewPerDay !== null && newCardsPerDay < neededNewPerDay


  const reload = useCallback(async () => {
    setRefreshing(true)
    try { await fetchGoals() } finally { setRefreshing(false) }
  }, [fetchGoals])

  const errorKey = useMemo(() => (code: string): string => {
    switch (code) {
      case 'LIMIT_EXCEEDED': return 'goals.error.limitExceeded'
      case 'NOT_FOUND': return 'goals.error.notFound'
      case 'INVALID_INPUT': return 'goals.error.invalidInput'
      case 'CONFLICT': return 'goals.error.conflict'
      case 'AUTH_REQUIRED': return 'goals.error.authRequired'
      case 'FORBIDDEN': return 'goals.error.forbidden'
      default: return 'goals.error.unknown'
    }
  }, [])

  const submit = async () => {
    const trimmed = title.trim()
    if (trimmed.length < 1 || trimmed.length > 500) {
      setLocalError(t('form.error.title'))
      return
    }
    if (deckIds.size === 0) {
      setLocalError(t('form.error.decks'))
      return
    }
    setLocalError(null)
    setSubmitting(true)
    const id = await createGoal({
      // Still required by the NOT NULL column, no longer asked for: the two shipped adapters are
      // identical apart from their id, so the choice never changed a plan.
      domainId: availableDomainIds()[0],
      title: trimmed,
      // Derived, not typed: the learner's own figure when they pinned the minutes side, the
      // projection when they pinned a horizon. The learner cannot know the second number; the
      // app can, from unseen-card count and the time available.
      dailyMinutes: Math.max(1, Math.min(1440, Math.round(
        (basis === 'minutes' ? budgetMinutes : projection?.averageMinutesPerDay) ?? 20,
      ))),
      targetDate: daysAvailable === null
        ? null
        : new Date(Date.now() + daysAvailable * DAY_MS).toISOString().slice(0, 10),
      decks: [...deckIds].map((deck_id) => ({ deck_id, importance: NEUTRAL_IMPORTANCE })),
      // Mobile sent nothing here, so every phone-created goal planned with an uncapped intake
      // and an every-day rhythm no matter what its owner intended.
      settings: { cadence, newCardsPerDay },
    })
    setSubmitting(false)
    if (id) {
      setCreating(false)
      setTitle('')
      setDeckIds(new Set())
      setHorizonMonths(null)
      setBudgetMinutes(null)
      setBasis('date')
      setStudyDays(7)
      setNewCardsPerDay(DEFAULT_NEW_CARDS_PER_DAY)
    }
  }

  /**
   * Delete, not archive — and the dialog says which.
   *
   * `Alert.alert` IS the platform's modal, and it is what the archive confirmation already uses,
   * so a hand-rolled sheet here would be a second confirmation idiom in one screen. The message
   * names what actually goes (the plans) and what stays (the study record and the cards),
   * because the learner cannot tell those apart from the button.
   */
  const confirmDelete = (goalId: string, goalTitle: string) => {
    Alert.alert(
      t('goals.deleteConfirmTitle'),
      t('goals.deleteConfirmMessage', { title: goalTitle }),
      [
        { text: t('form.cancel'), style: 'cancel' },
        {
          text: t('goals.delete'),
          style: 'destructive',
          onPress: () => {
            setArchivingId(goalId)
            void deleteGoal(goalId).finally(() => setArchivingId(null))
          },
        },
      ],
    )
  }

  /**
   * Open the drawer, reading the archive the first time it is pulled.
   *
   * `archivedGoals === null` is "never asked"; `[]` is "asked, and there are none". Starting at
   * `[]` would let the drawer claim the archive is empty before anything had looked.
   */
  const toggleArchive = () => {
    const next = !archiveOpen
    setArchiveOpen(next)
    if (next && archivedGoals === null) void fetchArchivedGoals()
  }

  const confirmArchive = (goalId: string, goalTitle: string) => {
    Alert.alert(
      t('goals.archiveConfirmTitle'),
      t('goals.archiveConfirmMessage', { title: goalTitle }),
      [
        { text: t('form.cancel'), style: 'cancel' },
        {
          text: t('goals.archive'),
          style: 'destructive',
          onPress: () => {
            // Guarded because archiving is irreversible from this screen — the RPCs reject
            // archived goals, so a double press would surface a confusing NOT_FOUND.
            setArchivingId(goalId)
            void archiveGoal(goalId).finally(() => setArchivingId(null))
          },
        },
      ],
    )
  }

  return (
    <Screen padding={false} keyboard testID="learning-goals-screen">
      {/* `drawer`, not `back`: this is now the 🎯 drawer destination, and every other one uses
          the hamburger. With `back` there was no way to reopen the drawer from here, and the
          arrow popped to SettingsHome — the stack's initial route — rather than anywhere the
          learner had been. */}
      <ScreenHeader
        title={t('goals.title')}
        mode="drawer"
        rightContent={
          <TouchableOpacity
            onPress={() => setCreating((v) => !v)}
            style={styles.headerLink}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityState={{ expanded: creating }}
            {...testProps('learning-goal-new')}
          >
            <Text style={[theme.typography.caption, { color: theme.colors.primary }]}>
              {creating ? t('form.cancel') : t('goals.create')}
            </Text>
          </TouchableOpacity>
        }
      />

      <ScrollView
        contentContainerStyle={styles.body}
        // Without this, the first tap on Save only dismissed the keyboard and the form
        // looked like it had ignored the press.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void reload()} tintColor={theme.colors.primary} />
        }
      >
        {goalsError && (
          <Text style={[theme.typography.caption, { color: theme.colors.error }]} testID="learning-goals-error">
            {t(errorKey(goalsError.code))}
          </Text>
        )}

        {creating && (
          <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 10 }]}>
              {t('form.goalTitle')}
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              maxLength={500}
              placeholder={t('form.goalTitlePlaceholder')}
              placeholderTextColor={theme.colors.textTertiary}
              style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border }]}
              testID="learning-goal-title"
            />

            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 10 }]}>
              {t('form.decks')}
            </Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
              {t('form.decksHint')}
            </Text>
            {decks.length === 0 ? (
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 6 }]}>
                {t('form.noDecks')}
              </Text>
            ) : decks.map((deck, index) => {
              const selected = deckIds.has(deck.id)
              return (
                <View key={deck.id}>
                <TouchableOpacity
                  onPress={() => setDeckIds((prev) => {
                    const next = new Set(prev)
                    if (next.has(deck.id)) next.delete(deck.id)
                    else next.add(deck.id)
                    return next
                  })}
                  style={[styles.deckRow, {
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    borderWidth: selected ? 2 : 1,
                  }]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  {...testProps(`learning-goal-deck-${index}`)}
                >
                  <Text style={[theme.typography.bodySmall, {
                    color: selected ? theme.colors.primary : theme.colors.text,
                  }]} numberOfLines={1}>
                    {selected ? '\u2713 ' : ''}{deck.name}
                  </Text>
                </TouchableOpacity>
                </View>
              )
            })}

            {/* What the selection actually amounts to, in cards. "\ub371 2\uac1c" says nothing about
                the size of the job, and every number below is computed from this split. */}
            {selection.total > 0 && (
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 6 }]}
                {...testProps('learning-goal-decks-summary')}>
                {t('form.decksSummary', { total: selection.total, unseen: selection.unseen })}
              </Text>
            )}

            {/* \u2500\u2500 Which side of the question the learner is pinning \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}
            <Text style={[theme.typography.caption, { color: theme.colors.text, marginTop: 14 }]}>
              {t('form.basisLabel')}
            </Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
              {t('form.basisHint')}
            </Text>
            <View style={styles.chipRow} accessibilityRole="radiogroup">
              {(['date', 'minutes'] as const).map((option) => {
                const selected = basis === option
                return (
                  <TouchableOpacity
                    key={option}
                    onPress={() => setBasis(option)}
                    style={[styles.chip, {
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                      borderWidth: selected ? 2 : 1,
                    }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    {...testProps(`learning-goal-basis-${option}`)}
                  >
                    <Text style={[theme.typography.caption, {
                      color: selected ? theme.colors.primary : theme.colors.textSecondary,
                    }]}>
                      {selected ? '\u2713 ' : ''}
                      {t(option === 'date' ? 'form.basisDate' : 'form.basisMinutes')}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            {basis === 'date' ? (
              <>
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 10 }]}>
                  {t('form.targetDate')}
                </Text>
                <View style={styles.chipRow}>
                  {HORIZONS_MONTHS.map((months) => {
                    const selected = months === horizonMonths
                    return (
                      <TouchableOpacity
                        key={months}
                        onPress={() => setHorizonMonths(selected ? null : months)}
                        style={[styles.chip, {
                          borderColor: selected ? theme.colors.primary : theme.colors.border,
                          borderWidth: selected ? 2 : 1,
                        }]}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        {...testProps(`learning-goal-horizon-${months}`)}
                      >
                        <Text style={[theme.typography.caption, {
                          color: selected ? theme.colors.primary : theme.colors.textSecondary,
                        }]}>
                          {selected ? '\u2713 ' : ''}{t('form.horizonMonths', { count: months })}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </>
            ) : (
              <>
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 10 }]}>
                  {t('form.dailyBudget')}
                </Text>
                <View style={styles.unitField}>
                  <TextInput
                    value={budgetMinutes === null ? '' : String(budgetMinutes)}
                    onChangeText={(text) => {
                      // Clamped as it is typed rather than only on save: the finish date below
                      // is computed from this value, and clamping later would promise a date
                      // the saved goal can never hit.
                      const digits = text.replace(/[^0-9]/g, '')
                      setBudgetMinutes(digits === ''
                        ? null
                        : Math.max(1, Math.min(1440, Number.parseInt(digits, 10))))
                    }}
                    keyboardType="number-pad"
                    maxLength={4}
                    placeholder="30"
                    placeholderTextColor={theme.colors.textTertiary}
                    style={[styles.unitInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                    {...testProps('learning-goal-budget-minutes')}
                  />
                  {/* The unit sits in the field: the ko/ja/zh labels name none, so a bare
                      three-character box invites hours. */}
                  <Text style={[theme.typography.caption, styles.unitSuffix, { color: theme.colors.textTertiary }]}>
                    {t('form.minutesUnit')}
                  </Text>
                </View>
              </>
            )}

            {/* \u2500\u2500 Rhythm and intake \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}
            <Text style={[theme.typography.caption, { color: theme.colors.text, marginTop: 14 }]}>
              {t('form.studyDays')}
            </Text>
            <View style={styles.chipRow}>
              {STUDY_DAY_CHOICES.map((n) => {
                const selected = n === studyDays
                return (
                  <TouchableOpacity
                    key={n}
                    onPress={() => setStudyDays(n)}
                    style={[styles.dayChip, {
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                      borderWidth: selected ? 2 : 1,
                    }]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={t('form.studyDaysOption', { count: n })}
                    {...testProps(`learning-goal-study-days-${n}`)}
                  >
                    <Text style={[theme.typography.caption, {
                      color: selected ? theme.colors.primary : theme.colors.textSecondary,
                    }]}>
                      {n}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
            {/* The missing sentence: choosing fewer days makes every minute figure go UP, which
                without this reads as the app punishing the learner. */}
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 4 }]}>
              {t('form.studyDaysHint')}
            </Text>

            <Text style={[theme.typography.caption, { color: theme.colors.text, marginTop: 14 }]}>
              {t('form.newCardsPerDay')}
            </Text>
            <View style={styles.unitField}>
              <TextInput
                value={String(newCardsPerDay)}
                onChangeText={(text) => {
                  const digits = text.replace(/[^0-9]/g, '')
                  setNewCardsPerDay(digits === ''
                    ? 0
                    : Math.max(0, Math.min(999, Number.parseInt(digits, 10))))
                }}
                keyboardType="number-pad"
                maxLength={3}
                style={[styles.unitInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                {...testProps('learning-goal-new-cards')}
              />
              <Text style={[theme.typography.caption, styles.unitSuffix, { color: theme.colors.textTertiary }]}>
                {t('form.cardsUnit')}
              </Text>
            </View>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 4 }]}>
              {t('form.newCardsPerDayHint')}
            </Text>
            {/* 0 is a real answer, not a broken one, and nothing said so. */}
            {newCardsPerDay === 0 && (
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 2 }]}>
                {t('form.newCardsPerDayZero')}
              </Text>
            )}
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 2 }]}>
              {t('form.newCardsHint')}
            </Text>

            {/* What this goal will actually cost, before it is saved. The peak is stated next to
                the average because load piles up behind intake and the average alone understates
                the day the learner has to survive. */}
            <View style={[styles.planBox, { borderColor: theme.colors.border }]}
              accessibilityLabel={t('form.plan.title')}>
              <Text style={[theme.typography.caption, { color: theme.colors.text }]}>
                {t('form.plan.title')}
              </Text>
              {basis === 'date' ? (projection ? (
                <>
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.text, marginTop: 2 }]}
                    {...testProps('learning-goal-plan-summary')}>
                    {t('form.plan.minutes', { count: Math.max(1, Math.round(projection.averageMinutesPerDay)) })}
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                    {t('form.plan.peak', {
                      minutes: Math.round(projection.peakMinutesPerDay),
                      day: projection.peakDay + 1,
                    })}
                  </Text>
                  {/* The rate the HORIZON demands, named as such so it cannot be read as the
                      ceiling set above — they share a unit and used to disagree in silence. */}
                  {neededNewPerDay !== null && (
                    <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                      {t('form.plan.newPerDayNeeded', { count: neededNewPerDay })}
                    </Text>
                  )}
                  {capBlocksTarget && (
                    <Text style={[theme.typography.caption, { color: theme.colors.warning }]}
                      {...testProps('learning-goal-cap-warning')}>
                      {t('form.plan.capBelowNeeded', { count: newCardsPerDay })}
                    </Text>
                  )}
                </>
              ) : (
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 2 }]}>
                  {t('form.plan.needDecksAndDate')}
                </Text>
              )) : selection.total > 0 && budgetMinutes ? (
                <>
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.text, marginTop: 2 }]}
                    {...testProps('learning-goal-plan-summary')}>
                    {budgetFinishDate
                      ? t('form.plan.finishBy', { date: budgetFinishDate })
                      : t('form.plan.tooSlow')}
                  </Text>
                  {budgetFinishDate && (
                    <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                      {t('form.plan.peakBasis')}
                    </Text>
                  )}
                </>
              ) : (
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 2 }]}>
                  {t('form.plan.needDecksAndBudget')}
                </Text>
              )}
              {/* Cramming and the sequential modes call apply_study_rating with no SRS payload,
                  so they move nothing here. Said out loud rather than left to be discovered. */}
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 4 }]}>
                {t('form.plan.srsOnly')}
              </Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                {t('form.plan.estimate')}
              </Text>
            </View>

            {localError && (
              <Text style={[theme.typography.caption, { color: theme.colors.error, marginTop: 8 }]}>
                {localError}
              </Text>
            )}

            <TouchableOpacity
              disabled={submitting}
              onPress={() => void submit()}
              style={[styles.primaryBtn, { backgroundColor: theme.colors.primary }, submitting && styles.disabled]}
              accessibilityRole="button"
              accessibilityState={{ disabled: submitting }}
              {...testProps('learning-goal-save')}
            >
              <Text style={[theme.typography.bodySmall, { color: theme.colors.textInverse }]}>
                {submitting ? t('form.saving') : t('form.save')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {goalsLoading && goals.length === 0 ? (
          <ActivityIndicator />
        ) : goals.length === 0 && !creating ? (
          <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
              {t('goals.empty.title')}
            </Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 4 }]}>
              {t('goals.empty.body')}
            </Text>
          </View>
        ) : goals.map((goal, index) => (
          <View
            key={goal.id}
            style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
            {...testProps(`learning-goal-${index}`, true)}
          >
            {/* The card IS the way in. Plans used to be switched from a chip row inside the plan
                itself; this list opens one instead. Archived goals stay unopenable — the RPCs
                reject them, so a tap would only surface a confusing NOT_FOUND. */}
            {/* The whole open-area is the tap target, not just the one line of title text.
                It used to be a style-less TouchableOpacity wrapping the title alone — ~18pt
                tall, under the 44pt floor this file declares for every other control — with
                the meta line and the warning below it dead to touch. The archive button stays
                a SIBLING so the container's `accessible: false` keeps it individually
                reachable under TalkBack. */}
            <TouchableOpacity
              disabled={goal.status !== 'active'}
              onPress={() => navigation.navigate('LearningToday', { goalId: goal.id })}
              activeOpacity={0.7}
              style={styles.openArea}
              accessibilityRole="button"
              accessibilityState={{ disabled: goal.status !== 'active' }}
              // testProps sets accessibilityLabel to the id on Android, so the label goes AFTER
              // it — otherwise the list's primary action announces "learning-goal-open-0".
              {...testProps(`learning-goal-open-${index}`)}
              accessibilityLabel={goal.title}
            >
              <Text style={[theme.typography.bodySmall, {
                color: goal.status === 'active' ? theme.colors.primary : theme.colors.text,
              }]} numberOfLines={1}>
                {goal.title}
              </Text>
              <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 2 }]}>
                {t('goals.dailyMinutes', { count: goal.daily_minutes })}
                {' · '}
                {t('goals.deckCount', { count: goal.decks.length })}
                {goal.status !== 'active' ? ` · ${t(`goals.status.${goal.status}`)}` : ''}
              </Text>
              {goal.decks.length === 0 && (
                <Text style={[theme.typography.caption, { color: theme.colors.warning, marginTop: 4 }]}>
                  {t('goals.noDecksWarning')}
                </Text>
              )}
            </TouchableOpacity>
            <View style={styles.rowActions}>
              <TouchableOpacity
                disabled={archivingId !== null}
                onPress={() => confirmArchive(goal.id, goal.title)}
                style={[styles.touchRow, archivingId !== null && styles.disabled]}
                hitSlop={HIT_SLOP}
                accessibilityRole="button"
                accessibilityState={{ disabled: archivingId !== null }}
                {...testProps(`learning-goal-archive-${index}`)}
              >
                <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                  {t('goals.archive')}
                </Text>
              </TouchableOpacity>
              {/* The only one of the two that cannot be undone, and the only one in the error
                  colour. Archiving used to wear it, which left nothing to escalate to. */}
              <TouchableOpacity
                disabled={archivingId !== null}
                onPress={() => confirmDelete(goal.id, goal.title)}
                style={[styles.touchRow, archivingId !== null && styles.disabled]}
                hitSlop={HIT_SLOP}
                accessibilityRole="button"
                accessibilityState={{ disabled: archivingId !== null }}
                {...testProps(`learning-goal-delete-${index}`)}
              >
                <Text style={[theme.typography.bodySmall, { color: theme.colors.error }]}>
                  {t('goals.delete')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {/* ── The archive ──────────────────────────────────────────────────
            Collapsed, and read only on the press that opens it: almost nobody has an archived
            goal, and folding this into `fetchGoals` would charge every session for the query.

            Until this existed, 보관 was strictly worse than 삭제 — the status flip was real, but
            `fetchGoals` filtered the row out and no screen read it back, so the goal and every
            plan it produced sat in the database unreachable. */}
        <TouchableOpacity
          onPress={toggleArchive}
          style={styles.touchRow}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityState={{ expanded: archiveOpen }}
          {...testProps('learning-archive-toggle')}
        >
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            {archiveOpen ? t('goals.archived.hide') : t('goals.archived.show')}
          </Text>
        </TouchableOpacity>

        {archiveOpen && (archivedGoalsLoading && archivedGoals === null ? (
          <ActivityIndicator />
        ) : (archivedGoals ?? []).length === 0 ? (
          <Text
            style={[theme.typography.caption, {
              color: theme.colors.textTertiary, textAlign: 'center', paddingVertical: 12,
            }]}
            {...testProps('learning-archive-empty')}
          >
            {t('goals.archived.empty')}
          </Text>
        ) : (archivedGoals ?? []).map((goal, index) => (
          // No open-area: the plan screen would call `save_daily_plan` for a goal the RPC
          // refuses. Reactivate first, and the row moves up into the list above.
          <View
            key={goal.id}
            style={[styles.card, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}
            {...testProps(`learning-archived-goal-${index}`, true)}
          >
            <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]} numberOfLines={1}>
              {goal.title}
            </Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 2 }]}>
              {t('goals.deckCount', { count: goal.decks.length })}
            </Text>
            <View style={styles.rowActions}>
              <TouchableOpacity
                disabled={archivingId !== null}
                onPress={() => {
                  // No confirmation: nothing is destroyed, and the button that undoes it is the
                  // 보관 button this row just came from.
                  setArchivingId(goal.id)
                  void restoreGoal(goal.id).finally(() => setArchivingId(null))
                }}
                style={[styles.touchRow, archivingId !== null && styles.disabled]}
                hitSlop={HIT_SLOP}
                accessibilityRole="button"
                accessibilityState={{ disabled: archivingId !== null }}
                {...testProps(`learning-archived-restore-${index}`)}
              >
                <Text style={[theme.typography.bodySmall, { color: theme.colors.primary }]}>
                  {t('goals.archived.restore')}
                </Text>
              </TouchableOpacity>
              {/* Kept reachable here, or the only way to be rid of an archived goal for good
                  would be to reactivate it first. */}
              <TouchableOpacity
                disabled={archivingId !== null}
                onPress={() => confirmDelete(goal.id, goal.title)}
                style={[styles.touchRow, archivingId !== null && styles.disabled]}
                hitSlop={HIT_SLOP}
                accessibilityRole="button"
                accessibilityState={{ disabled: archivingId !== null }}
                {...testProps(`learning-archived-delete-${index}`)}
              >
                <Text style={[theme.typography.bodySmall, { color: theme.colors.error }]}>
                  {t('goals.delete')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )))}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10, paddingBottom: 48 },
  card: { padding: 12, borderRadius: 12, borderWidth: 1 },
  headerLink: { minHeight: 32, paddingHorizontal: 6, justifyContent: 'center' },
  // `flexWrap` because the row is now as long as the registry, not fixed at two. Without it a
  // third domain pushes the last chip off-screen — worse in the locales with the longest names
  // (id "Hukum ketenagakerjaan", th "การเรียนทั่วไป"), which is where nobody would look.
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: {
    paddingHorizontal: 14, minHeight: MIN_TOUCH, borderRadius: 999, borderWidth: 1,
    justifyContent: 'center',
  },
  input: {
    marginTop: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10,
    minHeight: MIN_TOUCH,
  },
  // A number box that carries its unit. Without one, "30" in a box labelled only "하루에 쓸 수
  // 있는 시간" reads as hours just as easily as minutes.
  unitField: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  unitInput: {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 10,
    minHeight: MIN_TOUCH, minWidth: 96, textAlign: 'center',
  },
  unitSuffix: { minWidth: 40 },
  // Seven chips have to fit one row on a small phone, so these are square rather than pill-wide.
  dayChip: {
    width: MIN_TOUCH, minHeight: MIN_TOUCH, borderRadius: 999, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  deckRow: {
    marginTop: 6, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10,
    minHeight: MIN_TOUCH, justifyContent: 'center',
  },
  // 44pt minimum on every chip — the platform touch target, measured by the E2E spec.
  planBox: { borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 10 },
  primaryBtn: {
    marginTop: 12, minHeight: MIN_TOUCH, paddingVertical: 12, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  touchRow: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: 4 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 16, alignSelf: 'flex-start' },
  // The card's primary action. 44pt is the platform floor the E2E spec measures, and the
  // title alone never reached it.
  openArea: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingVertical: 4 },
  disabled: { opacity: 0.5 },
})
