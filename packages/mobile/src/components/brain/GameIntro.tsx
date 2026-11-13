import { useState, type ReactNode } from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import Animated from 'react-native-reanimated'
import { Feather } from '@expo/vector-icons'
import { useTranslation } from 'react-i18next'
import { formatCount } from '@reeeeecall/shared/lib/format-number'
import { GAME_THEMES, displayLevel, gameProgress, type BrainGameId } from '@reeeeecall/shared/lib/brain-games'
import { useBrainStore } from '@reeeeecall/shared/stores/brain-store'
import { CanvasButton, GameCanvas, GradientFill, StatTile } from './GameCanvas'
import { DemoPlayer } from './DemoPlayer'
import { useMotion } from './motion'
import { gameIcon, type FeatherName } from './brain-ui'
import { TierBar, TierMedal, backAfterBreak, opensWithPlacement, qeSpeedLevel, tierA11y, tierName, tierStanding } from './tier-ui'

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
  const meta = useBrainStore((s) => s.meta)
  const p = gameProgress(progress, gameId)
  const standing = tierStanding(gameId, meta, progress)
  // What the first trials will be: placement for a game never played, a re-fit after two weeks away.
  const placementNote = opensWithPlacement(gameId, meta, progress)
  const welcomeBack = !placementNote && backAfterBreak(gameId, meta)
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
              {/* This game's tier, and how far toward the next — this game's record only. */}
              <View style={styles.tier} accessible accessibilityLabel={`${t('tiers.label')} ${tierA11y(t, standing)}`} testID="brain-intro-tier">
                <View style={styles.tierChip}>
                  <TierMedal tier={standing.tier} size={22} />
                  <Text style={styles.tierChipText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                    {tierName(t, standing.tier)}
                  </Text>
                </View>
                <View style={styles.tierBar}>
                  <TierBar frac={standing.frac} color={theme.accent} height={6} />
                  <Text style={styles.tierNext} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                    {standing.next === null ? t('tiers.max') : `${t('tiers.next')} · ${tierName(t, standing.next)}`}
                  </Text>
                </View>
              </View>
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
                // Quick Eye: its speed level 0-11 — never a flash time. No level yet for a game never
                // played or a placement left part-way (n = 0) — not its interim probe level.
                value={p.rounds > 0 && meta.sk[gameId]?.n !== 0 ? (qe ? formatCount(qeSpeedLevel(p.level)) : displayLevel(p.level).toFixed(1)) : '—'}
                accent={theme.accent}
                center
              />
              <StatTile icon="layers" label={qe ? t('intro.stage') : t('intro.rounds')} value={qe ? formatCount(progress.quickEye.variant) : formatCount(p.rounds)} accent={theme.accent} center />
              <StatTile icon="award" label={t('intro.best')} value={best ? formatCount(best) : '—'} accent={theme.accent} center />
            </View>

            {firstTime || placementNote || welcomeBack ? (
              <View style={styles.notes}>
                {firstTime ? <Note icon="edit-3" text={t('intro.practiceNote')} /> : null}
                {placementNote ? <Note icon="compass" text={t('intro.firstPlacement')} testID="brain-intro-placement" /> : null}
                {welcomeBack ? <Note icon="sunrise" text={t('intro.welcomeBack')} testID="brain-intro-welcome-back" /> : null}
              </View>
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

function Note({ icon, text, testID }: { icon: FeatherName; text: string; testID?: string }) {
  return (
    <View style={styles.noteRow} testID={testID}>
      <Feather name={icon} size={18} color="rgba(255,255,255,0.8)" style={styles.noteIcon} />
      <Text style={styles.note} maxFontSizeMultiplier={1.5}>
        {text}
      </Text>
    </View>
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
  tier: { alignItems: 'center', gap: 8, marginTop: 2, marginBottom: 2, alignSelf: 'stretch' },
  tierChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 14, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', maxWidth: '100%' },
  tierChipText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', flexShrink: 1 },
  tierBar: { width: '70%', maxWidth: 260, gap: 4 },
  tierNext: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center' },
  notes: { gap: 10, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', padding: 14 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  noteIcon: { marginTop: 2 },
  note: { flex: 1, color: 'rgba(255,255,255,0.86)', fontSize: 16, lineHeight: 23 },
  bottom: {},
  fade: { position: 'absolute', left: 0, right: 0, top: -24, height: 24 },
  bottomBar: { paddingHorizontal: PADDING, paddingTop: 4, paddingBottom: 12 },
})
