import { useCallback, useEffect } from 'react'
import { View, Text, ScrollView, StyleSheet, Alert, BackHandler } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useNavigation } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { brainGame, courseStatus, displayLevel, localDayKey, weekProgress, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import { useTodaysTraining } from '@reeeeecall/shared/hooks/useTodaysTraining'
import type { RoundStats } from '@reeeeecall/shared/hooks/useBrainRound'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { Button, Screen } from '../../components/ui'
import { RoundView } from '../../components/brain/RoundView'
import { Stat } from '../../components/brain/RoundSummary'
import { useBrainHydrated } from '../../components/brain/useBrainHydrated'
import type { FeatherName } from '../../components/brain/brain-ui'
import { useTheme } from '../../theme'
import { testProps } from '../../utils/testProps'

/**
 * Today's Training: four games in a row, one bounded session. The session plans its line-up from
 * the player's progress, so it waits until that is loaded.
 */
export function BrainTrainingScreen() {
  const ready = useBrainHydrated()
  return <Screen padding={false}>{ready ? <Training /> : null}</Screen>
}

function Training() {
  const theme = useTheme()
  const { t } = useTranslation('brain')
  const navigation = useNavigation()
  const s = useTodaysTraining()
  const progress = useBrainStore((st) => st.progress)
  const { onRoundOver } = s
  const gameId = s.slot.gameId
  // No summary between rounds: the session moves on by itself, and the end screen sums it up.
  const onOver = useCallback((stats: RoundStats) => onRoundOver(gameId, stats), [onRoundOver, gameId])

  // Between games, Android's back button would leave mid-session without a word; ask first, as
  // "Finish" does during a round (RoundView handles the button while a round is up).
  const between = s.phase === 'between'
  useEffect(() => {
    if (!between) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert(t('play.stop'), t('play.stopConfirm'), [
        { text: t('play.resume'), style: 'cancel' },
        { text: t('play.stop'), style: 'destructive', onPress: () => navigation.goBack() },
      ])
      return true
    })
    return () => sub.remove()
  }, [between, navigation, t])

  if (s.phase === 'playing') {
    return (
      <RoundView
        key={s.roundKey}
        gameId={gameId}
        caption={t('training.slot', { index: s.slotIndex + 1, total: s.slots.length })}
        onOver={onOver}
        confirmEmpty
      />
    )
  }

  if (s.phase === 'between' && s.next) {
    const entry = brainGame(s.next.gameId)
    return (
      <Centered>
        <Text style={[styles.slot, { color: theme.colors.textSecondary }]}>
          {t('training.slot', { index: s.slotIndex + 2, total: s.slots.length })}
        </Text>
        <Text style={[styles.heading, { color: theme.colors.text }]}>{t('training.next')}</Text>
        <View style={[styles.nextGame, { backgroundColor: theme.colors.surface }]}>
          <View style={[styles.nextIcon, { backgroundColor: theme.colors.primaryLight }]}>
            <Feather name={entry.icon as FeatherName} size={28} color={theme.colors.primary} />
          </View>
          <View style={styles.nextText}>
            <Text style={[styles.nextName, { color: theme.colors.text }]}>{t(`games.${s.next.gameId}.name`)}</Text>
            <Text style={[styles.body, { color: theme.colors.textSecondary }]}>{t(`games.${s.next.gameId}.desc`)}</Text>
          </View>
        </View>
        <Button title={t('training.continue')} onPress={s.continueSession} size="lg" testID="brain-training-continue" />
        {/* A way out between games on every platform — iOS has no back button here and the swipe is
            off. Rounds so far are saved; the session is not counted. */}
        <Button
          title={t('play.stop')}
          variant="outline"
          size="lg"
          onPress={() =>
            Alert.alert(t('play.stop'), t('play.stopConfirm'), [
              { text: t('play.resume'), style: 'cancel' },
              { text: t('play.stop'), style: 'destructive', onPress: () => navigation.goBack() },
            ])
          }
          testID="brain-training-stop"
        />
      </Centered>
    )
  }

  // Done or stopped. The week and the course are read after the session was recorded.
  const today = localDayKey()
  const week = weekProgress(progress, today)
  const course = courseStatus(progress, today)
  const done = s.phase === 'done'
  const accuracy = s.totals.trials > 0 ? Math.round((s.totals.correct / s.totals.trials) * 100) : 0
  const levels = Object.entries(s.totals.levels) as [BrainGameId, { start: number; end: number }][]
  const courseLine =
    course.phase === 'booster' && course.booster
      ? t('training.booster', { done: course.booster.done, total: course.booster.total })
      : course.phase === 'maintenance' && course.nextBoosterOn
        ? t('training.boosterNext', { date: course.nextBoosterOn })
        : t('training.course', { done: course.coreDone, total: course.coreTotal })

  return (
    <Centered>
      <Feather name={done ? 'check-circle' : 'pause-circle'} size={40} color={done ? theme.colors.success : theme.colors.textSecondary} />
      <Text style={[styles.heading, { color: theme.colors.text }]}>{done ? t('training.doneTitle') : t('training.quitTitle')}</Text>
      <Text style={[styles.body, styles.centerText, { color: theme.colors.textSecondary }]}>{done ? t('training.doneBody') : t('training.quitBody')}</Text>
      {done ? (
        <View style={styles.chips}>
          <Text style={[styles.chip, { backgroundColor: theme.colors.surface, color: theme.colors.text }]}>
            {week.done >= week.goal ? t('training.weekDone') : t('training.week', { done: week.done, goal: week.goal })}
          </Text>
          <Text style={[styles.chip, { backgroundColor: theme.colors.surface, color: theme.colors.text }]}>{courseLine}</Text>
        </View>
      ) : null}
      <View style={styles.tiles}>
        <Stat label={t('summary.trials')} value={formatCount(s.totals.trials)} theme={theme} />
        <Stat label={t('summary.accuracy')} value={`${accuracy}%`} theme={theme} />
      </View>
      {levels.length > 0 ? (
        <View style={styles.levels}>
          {levels.map(([id, l]) => {
            const from = displayLevel(l.start)
            const to = displayLevel(l.end)
            const up = to > from
            return (
              <View key={id} style={styles.levelRow}>
                <Text style={[styles.body, styles.levelName, { color: theme.colors.text }]} numberOfLines={1}>
                  {t(`games.${id}.name`)}
                </Text>
                {up ? <Feather name="trending-up" size={16} color={theme.colors.success} /> : null}
                <Text style={[styles.body, styles.levelValue, { color: up ? theme.colors.success : theme.colors.textSecondary }]}>
                  {t('summary.levelChange', { from, to })}
                </Text>
              </View>
            )
          })}
        </View>
      ) : null}
      <Button title={t('training.backHome')} onPress={() => navigation.goBack()} size="lg" testID="brain-training-home" />
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  const theme = useTheme()
  return (
    <ScrollView contentContainerStyle={styles.centered} showsVerticalScrollIndicator={false}>
      <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]} {...testProps('brain-training-card', true)}>
        {children}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  centered: { flexGrow: 1, justifyContent: 'center', padding: 16 },
  card: { borderRadius: 20, borderWidth: 1, padding: 22, gap: 16, alignItems: 'center', width: '100%', maxWidth: 440, alignSelf: 'center' },
  slot: { fontSize: 15, fontVariant: ['tabular-nums'] },
  heading: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 22 },
  centerText: { textAlign: 'center' },
  nextGame: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 16, alignSelf: 'stretch' },
  nextIcon: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  nextText: { flex: 1, gap: 4 },
  nextName: { fontSize: 19, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  chip: { fontSize: 15, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, overflow: 'hidden' },
  tiles: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch' },
  levels: { alignSelf: 'stretch', gap: 8 },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  levelName: { flex: 1 },
  levelValue: { fontVariant: ['tabular-nums'] },
})
