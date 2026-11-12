import { useState, type ReactNode } from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import Animated from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { GAME_THEMES, displayLevel, gameProgress, quickEyeMsAt, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { CanvasButton, GameCanvas, GradientFill, StatTile } from './GameCanvas'
import { DemoPlayer } from './DemoPlayer'
import { useMotion } from './motion'
import { gameIcon } from './brain-ui'

const PADDING = 16

/**
 * Before a game: what it is, a demo of how it plays, where the player stands, and one big start.
 * Free practice shows it every time a game is opened; Today's Training shows it as each game of the
 * session comes up, with the session's steps across the top. `overlay` is drawn over the whole
 * screen (Today's Training puts its stop question there).
 */
export function GameIntro({
  gameId,
  onStart,
  onClose,
  closeLabel,
  steps,
  overlay,
}: {
  gameId: BrainGameId
  onStart: () => void
  onClose: () => void
  closeLabel: string
  /** Today's Training: the session's games and which one is next. */
  steps?: { games: BrainGameId[]; index: number; label: string }
  overlay?: ReactNode
}) {
  const { t } = useTranslation('brain')
  const theme = GAME_THEMES[gameId]
  const progress = useBrainStore((s) => s.progress)
  const p = gameProgress(progress, gameId)
  const best = progress.bestRuns[gameId]
  const firstTime = !progress.practiced.includes(gameId)
  const qe = gameId === 'quickEye'
  const [width, setWidth] = useState<number | null>(null)
  const rise = useMotion('rise', gameId)

  return (
    <GameCanvas theme={theme} testID="brain-intro">
      <View style={styles.root} onLayout={(e) => setWidth((w) => w ?? e.nativeEvent.layout.width - PADDING * 2)}>
        {/* Under an overlay (the stop question) the page is hidden from screen readers too. */}
        <View style={styles.root} importantForAccessibility={overlay ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={!!overlay}>
          <View style={styles.header}>
            <CanvasButton variant="chip" icon="x" label={closeLabel} onPress={onClose} theme={theme} testID="brain-intro-close" />
            {steps ? (
              <View style={styles.steps} accessible accessibilityLabel={`${steps.label} · ${t('training.slot', { index: steps.index + 1, total: steps.games.length })}`}>
                {steps.games.map((g, i) => {
                  const state = i < steps.index ? 'done' : i === steps.index ? 'now' : 'next'
                  return (
                    <View key={i} style={[styles.step, state === 'now' && styles.stepNow, { opacity: state === 'done' ? 0.55 : 1 }]}>
                      {state === 'next' ? <View style={[StyleSheet.absoluteFill, styles.stepNext]} /> : <GradientFill from={GAME_THEMES[g].cardFrom} to={GAME_THEMES[g].cardTo} width={40} height={40} light={0} />}
                      <Feather name={gameIcon(g)} size={20} color="#FFFFFF" />
                    </View>
                  )
                })}
              </View>
            ) : null}
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Animated.View style={[styles.hero, rise]}>
              <View style={[styles.icon, { boxShadow: `0 16px 48px ${theme.glow}` }]}>
                <View style={[StyleSheet.absoluteFill, styles.iconClip]}>
                  <GradientFill from={theme.cardFrom} to={theme.cardTo} width={80} height={80} />
                </View>
                <Feather name={gameIcon(gameId)} size={40} color="#FFFFFF" />
              </View>
              {steps ? (
                <Text style={[styles.slot, { color: theme.accent }]} maxFontSizeMultiplier={1.4}>
                  {t('training.slot', { index: steps.index + 1, total: steps.games.length })}
                </Text>
              ) : null}
              <Text style={styles.name} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
                {t(`games.${gameId}.name`)}
              </Text>
              <Text style={styles.desc} maxFontSizeMultiplier={1.5}>
                {t(`games.${gameId}.desc`)}
              </Text>
            </Animated.View>

            <View style={styles.section}>
              <Text style={styles.kicker} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
                {t('intro.howTo')}
              </Text>
              {width !== null ? <DemoPlayer gameId={gameId} width={width} centerOnly={progress.settings.centerOnly} /> : null}
            </View>

            <View style={styles.stats}>
              <StatTile
                icon="activity"
                label={qe ? t('intro.speed') : t('intro.level')}
                value={qe ? (p.rounds > 0 ? `${formatCount(quickEyeMsAt(p.level))}ms` : '—') : p.rounds > 0 ? displayLevel(p.level).toFixed(1) : '—'}
                accent={theme.accent}
                center
              />
              <StatTile icon="layers" label={qe ? t('intro.stage') : t('intro.rounds')} value={qe ? formatCount(progress.quickEye.variant) : formatCount(p.rounds)} accent={theme.accent} center />
              <StatTile icon="award" label={t('intro.best')} value={best ? formatCount(best) : '—'} accent={theme.accent} center />
            </View>

            {firstTime ? (
              <Text style={styles.note} maxFontSizeMultiplier={1.5}>
                {t('intro.practiceNote')}
              </Text>
            ) : null}
          </ScrollView>

          {/* Start stays in reach on short screens: it rides the bottom edge, the page scrolling under it. */}
          <View style={styles.bottom}>
            <View pointerEvents="none" style={styles.fade}>
              {FADE.map((o, i) => (
                <View key={i} style={{ flex: 1, backgroundColor: theme.canvasFrom, opacity: o }} />
              ))}
            </View>
            <View style={[styles.bottomBar, { backgroundColor: theme.canvasFrom }]}>
              <CanvasButton icon="play" label={t('intro.start')} onPress={onStart} theme={theme} testID="brain-intro-start" />
            </View>
          </View>
        </View>
        {overlay}
      </View>
    </GameCanvas>
  )
}

/** The fade above the start button, top to bottom — a stepped stand-in for a gradient. */
const FADE = [0.15, 0.35, 0.55, 0.75, 0.9]

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: PADDING, paddingTop: 8, minHeight: 56 },
  steps: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  step: { width: 40, height: 40, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  stepNow: { borderWidth: 2, borderColor: '#FFFFFF' },
  stepNext: { backgroundColor: 'rgba(255,255,255,0.10)' },
  content: { paddingHorizontal: PADDING, paddingTop: 8, paddingBottom: 24, gap: 20 },
  hero: { alignItems: 'center', gap: 8 },
  icon: { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  iconClip: { borderRadius: 24, overflow: 'hidden' },
  slot: { fontSize: 16, fontWeight: '600', marginTop: 4 },
  name: { color: '#FFFFFF', fontSize: 32, fontWeight: '800', textAlign: 'center', letterSpacing: -0.5 },
  desc: { color: 'rgba(255,255,255,0.82)', fontSize: 17, lineHeight: 25, textAlign: 'center', maxWidth: 440 },
  section: { gap: 8 },
  kicker: { color: 'rgba(255,255,255,0.72)', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  stats: { flexDirection: 'row', gap: 8 },
  note: { color: 'rgba(255,255,255,0.82)', fontSize: 16, lineHeight: 23, textAlign: 'center' },
  bottom: {},
  fade: { position: 'absolute', left: 0, right: 0, top: -24, height: 24 },
  bottomBar: { paddingHorizontal: PADDING, paddingTop: 4, paddingBottom: 12 },
})
