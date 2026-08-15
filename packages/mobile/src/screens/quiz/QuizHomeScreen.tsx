import { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, FlatList, Pressable, Alert } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import { AI_HUB_QUIZ } from '@reeeeecall/shared/lib/ai/hub/catalog'
import { AiCreditNotice } from '../../components/ai/AiCreditNotice'
import { useQuizStore, isDailyCheckTitle, type QuizSetRow } from '@reeeeecall/shared/stores/quiz-store'
import { Screen, Button, EmptyState, ListSkeleton, ScreenHeader } from '../../components/ui'
import { testProps } from '../../utils/testProps'
import { useTheme } from '../../theme'
import type { QuizStackParamList } from '../../navigation/types'
import { QuizMistakes } from './QuizMistakes'
import { dateLine } from '@reeeeecall/shared/lib/quiz-outcome'

type Nav = NativeStackNavigationProp<QuizStackParamList, 'QuizHome'>

/**
 * The sets you have made, and the button that makes more.
 *
 * Sets are the list, not runs: a set is what cost money and what is worth returning to, and
 * retaking one is free. A list of past sittings would bury the reusable thing under its history.
 */
export function QuizHomeScreen() {
  const theme = useTheme()
  const { t } = useTranslation('quiz')
  const navigation = useNavigation<Nav>()
  const { sets, loading, fetchSets, grantTrial, startRun, deleteSet } = useQuizStore()
  const [trialUnits, setTrialUnits] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void fetchSets()
    // Granted on first arrival rather than at signup: an allowance that expires before it is
    // seen buys nothing. The RPC is once-per-account, so later visits cost nothing.
    void grantTrial().then(setTrialUnits).catch(() => setTrialUnits(0))
  }, [fetchSets, grantTrial])

  /**
   * Remove a set nobody has taken.
   *
   * Offered only at `generated_count === 0` — the state 17 of production's 49 sets were stuck in.
   * A generation that produced nothing leaves a row that cannot be taken and could not be
   * cleared. A set with questions stays: its history is the reason the list shows sets at all.
   */
  /**
   * Delete, after saying what goes with it.
   *
   * Any set since mig 231, not only the empty ones — and the cascade takes the sittings, the
   * answers in them and their 오답 노트 entries, so the sentence that asks has to say so.
   */
  const remove = useCallback((setRow: QuizSetRow) => {
    const runs = setRow.run_count ?? 0
    Alert.alert(
      t('home.confirmTitle'),
      runs > 0 ? t('home.confirmTaken', { runs }) : t('home.confirmUnused'),
      [
        { text: t('home.confirmCancel'), style: 'cancel' },
        {
          text: t('home.confirmDelete'),
          style: 'destructive',
          onPress: () => {
            setBusy(setRow.id)
            void deleteSet(setRow.id).finally(() => setBusy(null))
          },
        },
      ],
    )
  }, [deleteSet, t])

  const take = useCallback(async (setRow: QuizSetRow) => {
    setBusy(setRow.id)
    try {
      const runId = await startRun(setRow.id)
      navigation.navigate('QuizRun', { runId })
    } finally {
      setBusy(null)
    }
  }, [navigation, startRun])

  return (
    <Screen>
      <ScreenHeader title={t('home.title')} mode="drawer" />
      {/* The same notice every AI screen shows, from one rule. Placed by feature id so it
          follows `hub/catalog.ts` rather than this file. */}
      <AiCreditNotice featureId={AI_HUB_QUIZ} style={{ marginHorizontal: 16, marginBottom: 12 }} />

      <View style={styles.actions}>
        <Button
          title={t('home.create')}
          onPress={() => navigation.navigate('QuizSetup')}
          {...testProps('quiz-create')}
        />
      </View>

      {/* Above the sets, because it is the thing to act on. Renders nothing until there is a
          miss to show, so a learner who has never got one wrong never sees it. */}
      <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
        <QuizMistakes />
      </View>

      {loading && sets.length === 0 ? (
        <ListSkeleton />
      ) : sets.length === 0 ? (
        <EmptyState title={t('home.empty.title')} description={t('home.empty.body')} />
      ) : (
        <FlatList
          data={sets}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const created = dateLine(item.created_at)
            const lastAt = item.last_taken_at ? dateLine(item.last_taken_at) : null
            return (
            <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
              {/* The row opens the set's own screen. The history, every past sitting and the
                  delete belong there: a list row is a place to CHOOSE a quiz, not to read one. */}
              <Pressable
                style={styles.cardBody}
                onPress={() => navigation.navigate('QuizSetDetail', { setId: item.id })}
                {...testProps(`quiz-set-open-${item.id}`)}
              >
                <Text style={[theme.typography.label, { color: theme.colors.text }]} numberOfLines={1}>
                  {/* `__daily_check__` is a SENTINEL — `build_daily_check` finds today's check by
                      that exact title rather than by a flag — and it was being shown to the
                      learner as if they had named it that. */}
                  {isDailyCheckTitle(item.title) ? t('home.dailyCheckTitle') : item.title}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                  {t(`type.${item.question_type}`)} · {t('home.questions', { count: item.generated_count })}
                </Text>
                {/* Under-delivery, said out loud. Dropped items are never charged for, so asking
                    for 6 and getting 4 is a normal outcome — but the set previously just read
                    "4 questions", indistinguishable from having asked for 4. */}
                {item.generated_count > 0 && item.generated_count < item.requested_count && (
                  <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                    {t('home.fewerThanAsked', { requested: item.requested_count })}
                  </Text>
                )}
                {/* One line of context, not the whole history: when it was made, and whether
                    it has ever been taken. The rest is a tap away. */}
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                  {[
                    created ? t('history.created', { date: t(created.key, created.params) }) : null,
                    (item.run_count ?? 0) === 0
                      ? t('history.never')
                      : t('history.taken', {
                        runs: item.run_count,
                        date: lastAt ? t(lastAt.key, lastAt.params) : '',
                      }),
                  ].filter(Boolean).join(' · ')}
                </Text>
              </Pressable>
              {/* Both, always. They used to be mutually exclusive — a 0-question set showed only
                  삭제 and every other row only 풀기 — so a set that had been taken could not be
                  removed from the list at all. Since mig 231 it can, and the two are different
                  weights rather than alternatives. */}
              <View style={styles.rowActions}>
                {item.generated_count > 0 && (
                  <Pressable
                    onPress={() => void take(item)}
                    disabled={busy === item.id}
                    style={[styles.take, { backgroundColor: theme.colors.primary, opacity: busy === item.id ? 0.5 : 1 }]}
                    {...testProps(`quiz-take-${item.id}`)}
                  >
                    <Text style={[theme.typography.label, { color: '#fff' }]}>
                      {busy === item.id ? t('home.starting') : t('home.take')}
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => remove(item)}
                  disabled={busy === item.id}
                  hitSlop={8}
                  style={{ padding: 6, opacity: busy === item.id ? 0.4 : 1 }}
                  accessibilityLabel={t('home.remove')}
                  {...testProps(`quiz-delete-${item.id}`)}
                >
                  {/* The destructive colour, not a bordered pill the same size as 풀기: the two
                      had identical geometry, so the row read as two equal choices. */}
                  <Text style={{ fontSize: 17, color: theme.colors.error }}>🗑</Text>
                </Pressable>
              </View>
            </View>
            )
          }}
        />
      )}

    </Screen>
  )
}

const styles = StyleSheet.create({
  actions: { paddingHorizontal: 16, marginBottom: 12 },
  list: { paddingHorizontal: 16, gap: 8, paddingBottom: 16 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  cardBody: { flex: 1, gap: 2 },
  take: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
})
