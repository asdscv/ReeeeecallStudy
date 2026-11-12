import { useEffect, useRef } from 'react'
import { View, Text, Pressable, StyleSheet, Animated, Easing } from 'react-native'
import { useTranslation } from 'react-i18next'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { displayLevel } from '@reeeeecall/shared/lib/brain-games'
import { useBrainSession, type BrainMode, type SessionStats } from '@reeeeecall/shared/hooks/useBrainSession'
import { useTheme } from '../../theme'
import { haptics } from '../../utils/haptics'
import { testProps } from '../../utils/testProps'
import { BrainBoard } from './BrainBoard'

/** One endless run. Unmounting it is how the run stops — every timer lives inside the hook. */
export function BrainSessionView({ mode, onFinish }: { mode: BrainMode; onFinish: (stats: SessionStats) => void }) {
  const theme = useTheme()
  const { t } = useTranslation('brain')
  const s = useBrainSession(mode)
  const leveledUp = s.result !== null && displayLevel(s.result.levelAfter) > displayLevel(s.result.levelBefore)

  // One buzz per judged round, not per render.
  useEffect(() => {
    if (!s.result) return
    if (s.result.correct) haptics.success()
    else haptics.error()
  }, [s.result])

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => onFinish(s.stats)} hitSlop={8} style={styles.finish} {...testProps('brain-finish')}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 15 }}>✕ {t('play.stop')}</Text>
        </Pressable>
        <View style={styles.title}>
          <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
            {s.mode === 'mix' ? <Text style={{ color: theme.colors.primary }}>{t('play.mixBadge')} · </Text> : null}
            {t(`games.${s.gameId}.name`)}
          </Text>
          <Text style={{ color: theme.colors.textTertiary, fontSize: 12 }} {...testProps('brain-level')}>
            {t('home.level', { level: s.level })}
          </Text>
        </View>
        <View style={styles.score}>
          <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }} {...testProps('brain-score')}>
            {formatCount(s.stats.points)}
          </Text>
          <Text style={{ color: theme.colors.textTertiary, fontSize: 12 }}>
            {s.stats.streak > 1 ? '🔥 ' : ''}{t('play.streak')} {s.stats.streak}
          </Text>
        </View>
      </View>

      <TimerBar key={s.roundId} timer={s.timer} />

      <View style={styles.body}>
        <Text style={[styles.prompt, { color: theme.colors.text }]} {...testProps('brain-prompt')}>
          {t(s.view.prompt.key, s.view.prompt.params)}
        </Text>
        <BrainBoard key={s.roundId} view={s.view} onTap={s.tap} />
        <View style={styles.resultRow}>
          {s.result ? (
            <Text
              style={{ fontSize: 18, fontWeight: '700', color: s.result.correct ? theme.colors.success : theme.colors.error, textAlign: 'center' }}
              {...testProps('brain-result')}
            >
              {s.result.correct ? t('play.correct') : s.result.timedOut ? t('play.timeUp') : t('play.wrong')}
              {s.result.points > 0 ? (
                <Text style={{ color: theme.colors.primary }}>  {t('play.points', { value: formatCount(s.result.points) })}</Text>
              ) : null}
              {leveledUp ? (
                <Text style={{ color: theme.colors.warning }}>  {t('play.levelUp', { level: displayLevel(s.result.levelAfter) })}</Text>
              ) : null}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  )
}

/** Drains from full to empty over the round's limit, on the native driver. */
function TimerBar({ timer }: { timer: { startedAt: number; limitMs: number } | null }) {
  const theme = useTheme()
  const scale = useRef(new Animated.Value(1)).current
  const startedAt = timer?.startedAt
  const limitMs = timer?.limitMs
  useEffect(() => {
    if (startedAt === undefined || limitMs === undefined) return
    const elapsed = Math.max(0, Date.now() - startedAt)
    scale.setValue(Math.max(0, 1 - elapsed / limitMs))
    const anim = Animated.timing(scale, {
      toValue: 0,
      duration: Math.max(0, limitMs - elapsed),
      easing: Easing.linear,
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [startedAt, limitMs, scale])
  return (
    <View style={[styles.track, { backgroundColor: theme.colors.surface }]}>
      {timer ? (
        <Animated.View
          style={[styles.fill, { backgroundColor: theme.colors.primary, transform: [{ scaleX: scale }] }]}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 8 },
  finish: { paddingVertical: 6, paddingRight: 4, minWidth: 72 },
  title: { flex: 1, alignItems: 'center' },
  score: { minWidth: 72, alignItems: 'flex-end' },
  track: { height: 6, borderRadius: 3, marginHorizontal: 16, overflow: 'hidden' },
  fill: { height: 6, width: '100%', borderRadius: 3, transformOrigin: 'left' },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 16, gap: 20, paddingBottom: 24 },
  prompt: { fontSize: 16, fontWeight: '600', textAlign: 'center', minHeight: 22 },
  resultRow: { minHeight: 28, justifyContent: 'center' },
})
