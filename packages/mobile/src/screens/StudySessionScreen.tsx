import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { View, Text, TouchableOpacity, ScrollView, Dimensions, StyleSheet, Alert } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import { Screen } from '../components/ui'
import { testProps } from '../utils/testProps'
import { useStudy } from '../hooks/useStudy'
import { useTranslation } from 'react-i18next'
import { useTheme, type Theme } from '../theme'
import { ratingColors } from '@reeeeecall/shared/design-tokens/colors'
import { RNTTS } from '../adapters/rn-tts'
import { useAuthState } from '../hooks/useAuthState'
import { getMobileSupabase } from '../adapters'
import type { StudyStackParamList } from '../navigation/types'

const tts = new RNTTS()

interface StudyProfile {
  tts_enabled: boolean
  tts_speed: number
  answer_mode: 'button' | 'swipe'
}

type Nav = NativeStackNavigationProp<StudyStackParamList, 'StudySession'>

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window')
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25
const VELOCITY_THRESHOLD = 500

const RATING_COLORS: Record<string, string> = {
  again: ratingColors.again,
  hard: ratingColors.hard,
  good: ratingColors.good,
  easy: ratingColors.easy,
}

// Default font sizes per layout style — matches web layout-styles.ts
const DEFAULT_FONT_SIZES: Record<string, number> = {
  primary: 40,
  secondary: 24,
  hint: 16,
  detail: 16,
  media: 16,
}

export function StudySessionScreen() {
  const theme = useTheme()
  const { t } = useTranslation('study')
  const navigation = useNavigation<Nav>()
  const {
    phase, currentCard, isFlipped, isRating, template, config,
    sessionStats, progress, flipCard, rateCard, exitSession,
    undoLastRating, lastRatedCard,
  } = useStudy()

  // Profile settings (TTS + answer mode)
  const { user } = useAuthState()
  const [profile, setProfile] = useState<StudyProfile>({ tts_enabled: true, tts_speed: 0.9, answer_mode: 'swipe' })
  useEffect(() => {
    if (!user?.id) return
    const supabase = getMobileSupabase()
    Promise.resolve(
      supabase.from('profiles').select('tts_enabled, tts_speed, answer_mode').eq('id', user.id).single()
    ).then(({ data }) => {
      if (data) setProfile(data as StudyProfile)
    }).catch(() => {})
  }, [user?.id])

  const isSwipeMode = profile.answer_mode === 'swipe'

  // Undo button visibility — auto-dismiss after 5 seconds
  const [showUndo, setShowUndo] = useState(false)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (lastRatedCard) {
      setShowUndo(true)
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
      undoTimerRef.current = setTimeout(() => setShowUndo(false), 5000)
    } else {
      setShowUndo(false)
    }
    return () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current) }
  }, [lastRatedCard?.timestamp])

  // Ref for the card-flip tap gesture — passed to TTSButton so it can
  // call blocksExternalGesture() and prevent flip when TTS is tapped
  const cardTapRef = useRef<any>(null)

  // Animation values — horizontal swipe only (vertical reserved for content scroll)
  const rotateY = useSharedValue(0)
  const translateX = useSharedValue(0)
  const cardScale = useSharedValue(1)

  // Navigate on session end — completed → summary, idle → back
  useEffect(() => {
    if (phase === 'completed') {
      navigation.replace('StudySummary')
    } else if (phase === 'idle' && sessionStats.cardsStudied > 0) {
      navigation.replace('StudySummary')
    } else if (phase === 'idle') {
      navigation.goBack()
    }
  }, [phase, navigation, sessionStats.cardsStudied])

  // Reset animations on card change
  useEffect(() => {
    rotateY.value = 0
    translateX.value = 0
    cardScale.value = 1
  }, [currentCard?.id])

  // Sync flip animation with state
  useEffect(() => {
    rotateY.value = withTiming(isFlipped ? 180 : 0, { duration: 300 })
  }, [isFlipped])

  // Auto-TTS on flip — reads first tts_enabled text field on back face.
  // Mirrors web StudySessionPage behavior; only fires when profile.tts_enabled.
  useEffect(() => {
    if (!isFlipped || !currentCard || !template) return
    if (!profile.tts_enabled) return
    const backLayout = template.back_layout ?? []
    for (const item of backLayout) {
      const field = template.fields.find((f) => f.key === item.field_key) as
        { key: string; type?: string; tts_enabled?: boolean; tts_lang?: string } | undefined
      if (!field || field.type !== 'text' || !field.tts_enabled) continue
      const value = currentCard.field_values[field.key]
      if (!value) continue
      tts.speak(value, field.tts_lang || 'en-US', profile.tts_speed)
      break
    }
  }, [isFlipped, currentCard, template, profile.tts_enabled, profile.tts_speed])

  // ── Animated styles (must be BEFORE early return — React hooks rule) ──
  const cardAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { scale: cardScale.value },
    ],
  }))

  const frontAnimStyle = useAnimatedStyle(() => {
    const rv = rotateY.value
    return {
      transform: [{ perspective: 1000 }, { rotateY: `${rv}deg` }],
      backfaceVisibility: 'hidden' as const,
      opacity: rv <= 90 ? 1 : 0,
    }
  })

  const backAnimStyle = useAnimatedStyle(() => {
    const rv = rotateY.value
    return {
      transform: [{ perspective: 1000 }, { rotateY: `${rv - 180}deg` }],
      backfaceVisibility: 'hidden' as const,
      opacity: rv > 90 ? 1 : 0,
    }
  })

  const hintStyle = useAnimatedStyle(() => {
    const absX = Math.abs(translateX.value)
    const opacity = interpolate(absX, [0, SWIPE_THRESHOLD], [0, 0.8], Extrapolation.CLAMP)
    let color = 'transparent'
    if (translateX.value < -30) color = RATING_COLORS.again
    else if (translateX.value > 30) color = RATING_COLORS.good
    return { opacity, backgroundColor: color }
  })

  if (!currentCard || phase !== 'studying') {
    return (
      <Screen testID="study-session-screen">
        <View style={styles.center}>
          <Text style={[theme.typography.h3, { color: theme.colors.textSecondary }]}>{t('session.loading')}</Text>
        </View>
      </Screen>
    )
  }

  const fields = template?.fields ?? []
  const frontFields = template?.front_layout ?? []
  const backFields = template?.back_layout ?? []

  const getFaceContent = (layout: typeof frontFields) => {
    return layout.map((item) => {
      const field = fields.find((f) => f.key === item.field_key) as { key: string; name?: string; tts_enabled?: boolean; tts_lang?: string; type?: string } | undefined
      const value = currentCard.field_values[item.field_key] ?? ''
      const fontSize = (item as { font_size?: number }).font_size ?? DEFAULT_FONT_SIZES[item.style] ?? DEFAULT_FONT_SIZES.primary
      // TTS: only if field has tts_enabled AND profile allows TTS (matches web getTTSFieldsForLayout)
      const ttsLang = (field?.tts_enabled && profile.tts_enabled) ? (field.tts_lang || 'en-US') : undefined
      return { key: item.field_key, value, style: item.style, fontSize, ttsLang, name: field?.name ?? item.field_key }
    }).filter((f) => f.value)
  }

  const frontContent = getFaceContent(frontFields)
  const backContent = getFaceContent(backFields)

  // Fallback if no template layout
  const fieldEntries = Object.entries(currentCard.field_values)
  const fallbackFront = frontContent.length > 0 ? frontContent : [{ key: 'f', value: fieldEntries[0]?.[1] ?? '', style: 'primary' as const, fontSize: DEFAULT_FONT_SIZES.primary, ttsLang: undefined as string | undefined, name: 'Front' }]
  const fallbackBack = backContent.length > 0 ? backContent : [{ key: 'b', value: fieldEntries[1]?.[1] ?? '', style: 'primary' as const, fontSize: DEFAULT_FONT_SIZES.primary, ttsLang: undefined as string | undefined, name: 'Back' }]



  const handleFlip = () => {
    if (!isRating) flipCard()
  }

  const handleRate = (rating: string) => {
    if (isRating) return
    rateCard(rating)
  }

  const handleUndo = () => {
    undoLastRating()
    setShowUndo(false)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
  }

  const handleExit = () => {
    Alert.alert(t('session.endSession'), t('session.endMessage'), [
      { text: t('session.continue'), style: 'cancel' },
      { text: t('session.end'), style: 'destructive', onPress: async () => {
        if (sessionStats.cardsStudied > 0) {
          await exitSession()
          // exitSession sets phase='completed' → useEffect navigates to Summary
        } else {
          // No cards studied — just go back
          navigation.goBack()
        }
      }},
    ])
  }

  const tapGesture = Gesture.Tap()
    .withRef(cardTapRef)
    .onEnd(() => {
      runOnJS(handleFlip)()
    })

  // Swipe gesture — only enabled AFTER flip (prevents rating from front face)
  const panGesture = Gesture.Pan()
    .enabled(isFlipped && !isRating)
    .activeOffsetX([-10, 10])
    .onUpdate((e) => {
      translateX.value = e.translationX
      cardScale.value = interpolate(
        Math.abs(e.translationX),
        [0, SCREEN_WIDTH],
        [1, 0.85],
        Extrapolation.CLAMP,
      )
    })
    .onEnd((e) => {
      const { translationX: tx, velocityX: vx } = e

      // Mode-aware swipe ratings: cramming → missed/got_it, srs → again/good, other → unknown/known
      const leftRating = config?.mode === 'cramming' ? 'missed' : config?.mode === 'srs' ? 'again' : 'unknown'
      const rightRating = config?.mode === 'cramming' ? 'got_it' : config?.mode === 'srs' ? 'good' : 'known'

      if (tx < -SWIPE_THRESHOLD || vx < -VELOCITY_THRESHOLD) {
        translateX.value = withTiming(-SCREEN_WIDTH)
        runOnJS(handleRate)(leftRating)
      } else if (tx > SWIPE_THRESHOLD || vx > VELOCITY_THRESHOLD) {
        translateX.value = withTiming(SCREEN_WIDTH)
        runOnJS(handleRate)(rightRating)
      } else {
        translateX.value = withSpring(0)
        cardScale.value = withSpring(1)
      }
    })

  // Compose: pan takes priority when dragging, tap fires on simple touch
  const composedGesture = Gesture.Race(panGesture, tapGesture)

  return (
    <GestureHandlerRootView style={[styles.flex, { backgroundColor: theme.colors.background }]}>
      <Screen safeArea padding={false} testID="study-session-screen">
        {/* Header */}
        <View style={[styles.header, { paddingHorizontal: 20 }]}>
          <TouchableOpacity onPress={handleExit} {...testProps('study-exit-button')}>
            <Text style={[theme.typography.body, { color: theme.colors.primary }]}>✕ {t('session.exit')}</Text>
          </TouchableOpacity>
          <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary }]}>
            {sessionStats.cardsStudied}/{sessionStats.totalCards}
          </Text>
          <Text style={[theme.typography.labelSmall, { color: theme.colors.textSecondary }]}>
            {progress}%
          </Text>
        </View>

        {/* Progress bar */}
        <View style={[styles.progressBar, { backgroundColor: theme.colors.surface }]}>
          <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: theme.colors.primary }]} />
        </View>

        {/* Card area */}
        <View style={styles.cardArea} {...testProps('study-card-area', true)}>
          <GestureDetector gesture={composedGesture}>
            <Animated.View style={[styles.cardContainer, cardAnimStyle]} {...testProps('study-card-tap')}>
              {/* Swipe hint overlay — pointerEvents='none' so it never steals touches from TTS buttons */}
              <Animated.View style={[styles.swipeHint, hintStyle]} pointerEvents="none" />

              {/* Front face — tap to flip, TTS inline */}
              <Animated.View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }, frontAnimStyle]}>
                <CardFace content={fallbackFront} theme={theme} ttsSpeed={profile.tts_speed} cardTapRef={cardTapRef} />
                <Text style={[theme.typography.caption, styles.tapHint, { color: theme.colors.textTertiary }]}>
                  {t('session.tapToFlip')}
                </Text>
              </Animated.View>

              {/* Back face — scrollable for long content, TTS inline */}
              <Animated.View style={[styles.card, styles.cardBack, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }, backAnimStyle]}>
                <CardFace content={fallbackBack} theme={theme} ttsSpeed={profile.tts_speed} scrollable cardTapRef={cardTapRef} />
              </Animated.View>
            </Animated.View>
          </GestureDetector>
        </View>

        {/* Undo button — appears after rating, auto-dismisses after 5s */}
        {showUndo && !isFlipped && phase === 'studying' && (
          <View style={styles.undoRow}>
            <TouchableOpacity
              onPress={handleUndo}
              style={[styles.undoBtn, { borderColor: theme.colors.border }]}
              activeOpacity={0.7}
              {...testProps('study-undo-button')}
            >
              <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary }]}>
                ↩ {t('session.undo')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Rating area — button mode: buttons, swipe mode: hints */}
        {isFlipped && isSwipeMode && (
          <View style={styles.swipeRatingHint}>
            <Text style={[theme.typography.caption, { color: RATING_COLORS.again }]}>{'\u2190'} {t('srsRating.again')}</Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>Swipe</Text>
            <Text style={[theme.typography.caption, { color: RATING_COLORS.good }]}>{t('srsRating.good')} {'\u2192'}</Text>
          </View>
        )}
        {isFlipped && !isSwipeMode && (
          <View style={[styles.ratingRow, { paddingHorizontal: 16 }]}>
            {config?.mode === 'srs' ? (
              <>
                <RatingButton label={t('srsRating.again')} color={RATING_COLORS.again} onPress={() => handleRate('again')} disabled={isRating} />
                <RatingButton label={t('srsRating.hard')} color={RATING_COLORS.hard} onPress={() => handleRate('hard')} disabled={isRating} />
                <RatingButton label={t('srsRating.good')} color={RATING_COLORS.good} onPress={() => handleRate('good')} disabled={isRating} />
                <RatingButton label={t('srsRating.easy')} color={RATING_COLORS.easy} onPress={() => handleRate('easy')} disabled={isRating} />
              </>
            ) : config?.mode === 'cramming' ? (
              <>
                <RatingButton label={t('rating.missed')} color={RATING_COLORS.again} onPress={() => handleRate('missed')} disabled={isRating} />
                <RatingButton label={t('rating.gotIt')} color={RATING_COLORS.good} onPress={() => handleRate('got_it')} disabled={isRating} />
              </>
            ) : (
              <>
                <RatingButton label={t('rating.unknown')} color={RATING_COLORS.again} onPress={() => handleRate('unknown')} disabled={isRating} />
                <RatingButton label={t('rating.known')} color={RATING_COLORS.good} onPress={() => handleRate('known')} disabled={isRating} />
              </>
            )}
          </View>
        )}

        {/* Tap hint — front face */}
        {!isFlipped && (
          <View style={styles.bottomHints}>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, textAlign: 'center' }]}>
              {t('session.swipeHint')}
            </Text>
          </View>
        )}
      </Screen>
    </GestureHandlerRootView>
  )
}

/** TTS button — uses its own GestureDetector with Gesture.Tap() that calls
 *  blocksExternalGesture(cardTapRef) to explicitly prevent the parent card-flip
 *  tap from activating when this button is tapped. This is the RNGH v2 way
 *  to resolve nested gesture conflicts at the native level. */
function TTSButton({ text, lang, speed, color, cardTapRef }: {
  text: string; lang: string; speed: number
  color: string
  cardTapRef: React.RefObject<any>
}) {
  const handlePress = useCallback(() => {
    tts.speak(text, lang, speed)
  }, [text, lang, speed])

  const ttsTap = Gesture.Tap()
    .blocksExternalGesture(cardTapRef)
    .onEnd(() => {
      runOnJS(handlePress)()
    })

  return (
    <GestureDetector gesture={ttsTap}>
      <Animated.View style={styles.ttsInlineBtn} hitSlop={8}>
        <Text style={{ fontSize: 18, color }}>{'\uD83D\uDD0A'}</Text>
      </Animated.View>
    </GestureDetector>
  )
}

// CJK Han / Hiragana / Katakana need extra lineHeight on iOS (PingFang/HiraKaku
// glyph ascent exceeds 1.5x at large sizes, clipping the top stroke). Hangul
// (U+AC00–U+D7AF) is intentionally excluded — it renders fine at 1.5x.
const CJK_RE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/

function CardFace({ content, theme, ttsSpeed = 0.9, scrollable = false, cardTapRef }: {
  content: Array<{ key: string; value: string; style: string; fontSize?: number; ttsLang?: string; name: string }>
  theme: Theme
  ttsSpeed?: number
  scrollable?: boolean
  cardTapRef: React.RefObject<any>
}) {
  const inner = content.map((field) => {
    const size = field.fontSize ?? DEFAULT_FONT_SIZES[field.style] ?? DEFAULT_FONT_SIZES.primary
    const isBold = field.style === 'primary' || field.style === 'secondary'
    const isHint = field.style === 'hint'
    const isDetail = field.style === 'detail'
    const color = (isHint || isDetail) ? theme.colors.textSecondary : theme.colors.text
    const isCJK = CJK_RE.test(field.value)
    const lineHeight = size * (isCJK ? 1.8 : 1.5)
    // CJK text wraps per-character (no word boundaries), so a slightly narrow row
    // forces a break between every glyph. Keep it single-line; truncate if too long.
    // (adjustsFontSizeToFit was removed — iOS measures flex:1+row width too narrow
    //  for CJK and shrinks aggressively even when there's plenty of horizontal room.)
    const singleLineProps = isCJK ? { numberOfLines: 1, ellipsizeMode: 'tail' as const } : {}

    return (
      <View key={field.key} style={[styles.fieldBlock, isHint && styles.hintBlock]}>
        {/* TTS button inline — own GestureDetector blocks parent card-flip tap */}
        {field.ttsLang ? (
          <View style={styles.ttsRow}>
            <TTSButton text={field.value} lang={field.ttsLang} speed={ttsSpeed} color={theme.colors.primary} cardTapRef={cardTapRef} />
            <Text
              {...singleLineProps}
              style={{
                flex: 1,
                // iOS RN measures flex:1 Text width too narrow inside a row when
                // the text has no word boundaries (CJK), causing per-glyph wrap.
                // minWidth: 0 unlocks the flexbox shrink calc.
                minWidth: 0,
                fontSize: size,
                fontWeight: isBold ? '700' : '400',
                fontStyle: isHint ? 'italic' : 'normal',
                color,
                textAlign: 'center',
                lineHeight,
              }}
            >
              {field.value}
            </Text>
          </View>
        ) : (
          <Text
            {...singleLineProps}
            style={{
              fontSize: size,
              fontWeight: isBold ? '700' : '400',
              fontStyle: isHint ? 'italic' : 'normal',
              color,
              textAlign: 'center',
              lineHeight,
            }}
          >
            {field.value}
          </Text>
        )}
      </View>
    )
  })

  if (scrollable) {
    return (
      <ScrollView
        contentContainerStyle={styles.cardScrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
        nestedScrollEnabled
      >
        {inner}
      </ScrollView>
    )
  }

  return <View style={styles.cardContent}>{inner}</View>
}


function RatingButton({ label, color, onPress, disabled }: {
  label: string; color: string; onPress: () => void; disabled: boolean
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      style={[styles.ratingBtn, { backgroundColor: color, opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={styles.ratingLabel}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  progressBar: { height: 3, marginHorizontal: 20, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
  cardArea: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  cardContainer: { width: '100%', height: SCREEN_HEIGHT * 0.55 },
  card: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 20, borderWidth: 1, padding: 24, justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 5,
  },
  cardBack: { },
  cardContent: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, width: '100%' },
  cardScrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 8 },
  fieldBlock: { width: '100%', alignItems: 'center' },
  hintBlock: { borderLeftWidth: 2, borderLeftColor: '#e5e7eb', paddingLeft: 12, alignItems: 'flex-start' },
  ttsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, width: '100%' },
  ttsInlineBtn: { padding: 8 },
  tapHint: { position: 'absolute', bottom: 16 },
  swipeHint: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 20, zIndex: 10,
  },
  ratingRow: { flexDirection: 'row', gap: 8, paddingBottom: 24 },
  ratingBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  ratingLabel: { color: '#fff', fontWeight: '700', fontSize: 14 },
  swipeRatingHint: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 32, paddingBottom: 20 },
  bottomHints: { alignItems: 'center', paddingBottom: 20, paddingHorizontal: 20, gap: 8 },
  undoRow: { alignItems: 'center', paddingBottom: 8 },
  undoBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
})
