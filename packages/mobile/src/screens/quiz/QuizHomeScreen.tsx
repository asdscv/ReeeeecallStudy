import { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import { useQuizStore, type QuizSetRow } from '@reeeeecall/shared/stores/quiz-store'
import { formatUsdMicro } from '@reeeeecall/shared/lib/ai/server-client'
import { Screen, Button, EmptyState, ListSkeleton, ScreenHeader } from '../../components/ui'
import { testProps } from '../../utils/testProps'
import { useTheme } from '../../theme'
import type { QuizStackParamList } from '../../navigation/types'

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
  const { sets, loading, fetchSets, grantTrial, startRun } = useQuizStore()
  const [trialUnits, setTrialUnits] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void fetchSets()
    // Granted on first arrival rather than at signup: an allowance that expires before it is
    // seen buys nothing. The RPC is once-per-account, so later visits cost nothing.
    void grantTrial().then(setTrialUnits).catch(() => setTrialUnits(0))
  }, [fetchSets, grantTrial])

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

      {trialUnits > 0 && (
        <View style={[styles.banner, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
          <Text style={[theme.typography.label, { color: theme.colors.text }]}>{t('home.trial.title')}</Text>
          <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
            {t('home.trial.body', { count: trialUnits })}
          </Text>
        </View>
      )}

      <View style={styles.actions}>
        <Button
          title={t('home.create')}
          onPress={() => navigation.navigate('QuizSetup')}
          {...testProps('quiz-create')}
        />
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
                  {item.title}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textSecondary }]}>
                  {t(`type.${item.question_type}`)} · {t('home.questions', { count: item.generated_count })} · {t('home.retakeFree')}
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
              <Pressable
                onPress={() => void take(item)}
                disabled={busy === item.id || item.generated_count === 0}
                style={[styles.take, { backgroundColor: theme.colors.primary, opacity: busy === item.id ? 0.5 : 1 }]}
                {...testProps(`quiz-take-${item.id}`)}
              >
                <Text style={[theme.typography.label, { color: '#fff' }]}>
                  {busy === item.id ? t('home.starting') : t('home.take')}
                </Text>
              </Pressable>
            </View>
          )}
        />
      )}

      <Text style={[theme.typography.caption, styles.note, { color: theme.colors.textSecondary }]}>
        {t('home.pricingNote', { price: formatUsdMicro(5000) })}
      </Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  banner: { padding: 12, borderRadius: 12, borderWidth: 1, marginHorizontal: 16, marginBottom: 12, gap: 2 },
  actions: { paddingHorizontal: 16, marginBottom: 12 },
  list: { paddingHorizontal: 16, gap: 8, paddingBottom: 16 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  cardBody: { flex: 1, gap: 2 },
  take: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  note: { textAlign: 'center', paddingHorizontal: 16, paddingBottom: 12 },
})
