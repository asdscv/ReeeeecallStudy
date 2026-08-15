import { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native'
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
  const remove = useCallback(async (setRow: QuizSetRow) => {
    setBusy(setRow.id)
    try { await deleteSet(setRow.id) } finally { setBusy(null) }
  }, [deleteSet])

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
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
              <View style={styles.cardBody}>
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
              </View>
              {item.generated_count === 0 ? (
                <Pressable
                  onPress={() => void remove(item)}
                  disabled={busy === item.id}
                  style={[styles.take, { borderWidth: 1, borderColor: theme.colors.border,
                    opacity: busy === item.id ? 0.5 : 1 }]}
                  {...testProps(`quiz-delete-${item.id}`)}
                >
                  <Text style={[theme.typography.label, { color: theme.colors.text }]}>
                    {t('home.remove')}
                  </Text>
                </Pressable>
              ) : (
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
            </View>
          )}
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
})
