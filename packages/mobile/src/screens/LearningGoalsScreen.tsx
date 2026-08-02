import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { Screen, ScreenHeader } from '../components/ui'
import { useTheme } from '../theme'
import { testProps } from '../utils/testProps'
import { availableDomainIds, projectWorkload } from '@reeeeecall/shared/learning'
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
  const { goals, goalsLoading, goalsError, fetchGoals, createGoal, archiveGoal } = useLearningStore()
  const { decks, stats, fetchDecks, fetchStats } = useDeckStore()
  const userId = useAuthStore((state) => state.user?.id)

  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [title, setTitle] = useState('')
  const [horizonMonths, setHorizonMonths] = useState<number | null>(null)
  const [deckIds, setDeckIds] = useState<Set<string>>(new Set())
  const [localError, setLocalError] = useState<string | null>(null)

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

  const projection = useMemo(() => {
    if (selection.total === 0 || daysAvailable === null) return null
    return projectWorkload({
      unseenCards: selection.unseen, seenCards: selection.seen, daysAvailable,
      secondsPerCard: ASSUMED_SECONDS_PER_CARD, lapseRate: ASSUMED_LAPSE_RATE,
      consolidationDays: CONSOLIDATION_DAYS,
    })
  }, [selection.unseen, selection.seen, selection.total, daysAvailable])


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
      // Derived from the horizon rather than typed. The learner cannot know this number; the
      // app can, from unseen-card count and the time available.
      dailyMinutes: Math.max(1, Math.min(1440, Math.round(projection?.averageMinutesPerDay ?? 20))),
      targetDate: daysAvailable === null
        ? null
        : new Date(Date.now() + daysAvailable * DAY_MS).toISOString().slice(0, 10),
      decks: [...deckIds].map((deck_id) => ({ deck_id, importance: NEUTRAL_IMPORTANCE })),
    })
    setSubmitting(false)
    if (id) {
      setCreating(false)
      setTitle('')
      setDeckIds(new Set())
      setHorizonMonths(null)
    }
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
      <ScreenHeader
        title={t('goals.title')}
        mode="back"
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

            {/* What this goal will actually cost, before it is saved. The peak is stated next to
                the average because load piles up behind intake and the average alone understates
                the day the learner has to survive. */}
            <View style={[styles.planBox, { borderColor: theme.colors.border }]}
              accessibilityLabel={t('form.plan.title')}>
              <Text style={[theme.typography.caption, { color: theme.colors.text }]}>
                {t('form.plan.title')}
              </Text>
              {projection ? (
                <>
                  <Text style={[theme.typography.bodySmall, { color: theme.colors.text, marginTop: 2 }]}
                    {...testProps('learning-goal-plan-summary')}>
                    {t('form.plan.newPerDay', { count: projection.newCardsPerDay })}
                    {' · '}
                    {t('form.plan.minutes', { count: Math.max(1, Math.round(projection.averageMinutesPerDay)) })}
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                    {t('form.plan.peak', {
                      minutes: Math.round(projection.peakMinutesPerDay),
                      day: projection.peakDay + 1,
                    })}
                  </Text>
                </>
              ) : (
                <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, marginTop: 2 }]}>
                  {t('form.plan.needDecksAndDate')}
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
            <Text style={[theme.typography.bodySmall, { color: theme.colors.text }]} numberOfLines={1}>
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
            <TouchableOpacity
              disabled={archivingId !== null}
              onPress={() => confirmArchive(goal.id, goal.title)}
              style={[styles.touchRow, { alignSelf: 'flex-start' }, archivingId !== null && styles.disabled]}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              accessibilityState={{ disabled: archivingId !== null }}
              {...testProps(`learning-goal-archive-${index}`)}
            >
              <Text style={[theme.typography.bodySmall, { color: theme.colors.error }]}>
                {t('goals.archive')}
              </Text>
            </TouchableOpacity>
          </View>
        ))}
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
  disabled: { opacity: 0.5 },
})
