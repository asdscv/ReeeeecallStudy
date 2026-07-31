import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { Screen, ScreenHeader } from '../components/ui'
import { useTheme } from '../theme'
import { testProps } from '../utils/testProps'
import { useLearningStore } from '@reeeeecall/shared/stores/learning-store'
import { useDeckStore } from '@reeeeecall/shared/stores/deck-store'

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
const DOMAINS = ['language', 'labor-law'] as const

const MIN_TOUCH = 44
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const

export function LearningGoalsScreen() {
  const { t } = useTranslation('learning')
  const theme = useTheme()
  const { goals, goalsLoading, goalsError, fetchGoals, createGoal, archiveGoal } = useLearningStore()
  const { decks, fetchDecks } = useDeckStore()

  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [domainId, setDomainId] = useState<string>(DOMAINS[0])
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState('20')
  const [deckIds, setDeckIds] = useState<Set<string>>(new Set())
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => { void fetchGoals() }, [fetchGoals])
  useEffect(() => { if (creating) void fetchDecks() }, [creating, fetchDecks])

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
    const dailyMinutes = Number.parseInt(minutes, 10)
    if (!Number.isInteger(dailyMinutes) || dailyMinutes < 1 || dailyMinutes > 1440) {
      setLocalError(t('form.error.dailyMinutes'))
      return
    }
    setLocalError(null)
    setSubmitting(true)
    const id = await createGoal({
      domainId,
      title: trimmed,
      dailyMinutes,
      // Uniform importance: there is no product concept for weighting a deck yet, and a
      // hidden default other than the neutral 0.5 would tilt the planner unasked.
      decks: [...deckIds].map((deck_id) => ({ deck_id, importance: 0.5 })),
    })
    setSubmitting(false)
    if (id) {
      setCreating(false)
      setTitle('')
      setDeckIds(new Set())
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
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>{t('form.domain')}</Text>
            <View style={styles.chipRow}>
              {DOMAINS.map((domain) => {
                const selected = domain === domainId
                return (
                  <TouchableOpacity
                    key={domain}
                    onPress={() => setDomainId(domain)}
                    style={[styles.chip, {
                      borderColor: selected ? theme.colors.primary : theme.colors.border,
                      borderWidth: selected ? 2 : 1,
                    }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    {...testProps(`learning-goal-domain-${domain}`)}
                  >
                    <Text style={[theme.typography.caption, {
                      color: selected ? theme.colors.primary : theme.colors.textSecondary,
                    }]}>
                      {selected ? '\u2713 ' : ''}{t(`form.domainName.${domain}`)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

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
              {t('form.dailyMinutes')}
            </Text>
            <TextInput
              value={minutes}
              onChangeText={setMinutes}
              keyboardType="number-pad"
              style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border }]}
              testID="learning-goal-minutes"
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
                <TouchableOpacity
                  key={deck.id}
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
              )
            })}

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
  chipRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
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
  primaryBtn: {
    marginTop: 12, minHeight: MIN_TOUCH, paddingVertical: 12, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  touchRow: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: 4 },
  disabled: { opacity: 0.5 },
})
