import { useEffect, useState, useRef } from 'react'
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
import type { StudyStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<StudyStackParamList, 'StudySession'>

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25
const VELOCITY_THRESHOLD = 500

const RATING_COLORS: Record<string, string> = {
  again: ratingColors.again,
  hard: ratingColors.hard,
  good: ratingColors.good,
  easy: ratingColors.easy,
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

  // Animation values — horizontal swipe only (vertical reserved for content scroll)
  const rotateY = useSharedValue(0)
  const translateX = useSharedValue(0)
  const cardScale = useSharedValue(1)

  // Navigate to summary when complete
  useEffect(() => {
    if (phase === 'completed') {
      navigation.replace('StudySummary')
    }
  }, [phase, navigation])

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
      const field = fields.find((f) => f.key === item.field_key)
      const value = currentCard.field_values[item.field_key] ?? ''
      return { key: item.field_key, value, style: item.style, name: field?.name ?? item.field_key }
    }).filter((f) => f.value)
  }

  const frontContent = getFaceContent(frontFields)
  const backContent = getFaceContent(backFields)

  // Fallback if no template layout
  const fieldEntries = Object.entries(currentCard.field_values)
  const fallbackFront = frontContent.length > 0 ? frontContent : [{ key: 'f', value: fieldEntries[0]?.[1] ?? '', style: 'primary' as const, name: 'Front' }]
  const fallbackBack = backContent.length > 0 ? backContent : [{ key: 'b', value: fieldEntries[1]?.[1] ?? '', style: 'primary' as const, name: 'Back' }]


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
      { text: t('session.end'), style: 'destructive', onPress: () => exitSession() },
    ])
  }

  // Tap gesture — handles flip (GestureDetector blocks TouchableOpacity taps)
  const tapGesture = Gesture.Tap()
    .enabled(!isRating)
    .onEnd(() => {
      runOnJS(handleFlip)()
    })

  // Swipe gesture — left/right only (again/good)
  const panGesture = Gesture.Pan()
    .enabled(!isRating)
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

      if (tx < -SWIPE_THRESHOLD || vx < -VELOCITY_THRESHOLD) {
        translateX.value = withTiming(-SCREEN_WIDTH)
        runOnJS(handleRate)('again')
      } else if (tx > SWIPE_THRESHOLD || vx > VELOCITY_THRESHOLD) {
        translateX.value = withTiming(SCREEN_WIDTH)
        runOnJS(handleRate)('good')
      } else {
        translateX.value = withSpring(0)
        cardScale.value = withSpring(1)
      }
    })

  return (
    <GestureHandlerRootView style={styles.flex}>
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
          <GestureDetector gesture={Gesture.Race(tapGesture, panGesture)}>
            <Animated.View style={[styles.cardContainer, cardAnimStyle]}>
              {/* Swipe hint overlay */}
              <Animated.View style={[styles.swipeHint, hintStyle]} />

              <View style={styles.flex} {...testProps('study-card-tap')}>
                {/* Front face — tap to flip, no scroll */}
                <Animated.View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }, frontAnimStyle]}>
                  <CardFace content={fallbackFront} theme={theme} />
                  <Text style={[theme.typography.caption, styles.tapHint, { color: theme.colors.textTertiary }]}>
                    {t('session.tapToFlip')}
                  </Text>
                </Animated.View>

                {/* Back face — scrollable for long content */}
                <Animated.View style={[styles.card, styles.cardBack, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }, backAnimStyle]}>
                  <CardFace content={fallbackBack} theme={theme} scrollable />
                </Animated.View>
              </View>
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

        {/* Swipe hint — left: Again, right: Good */}
        {isFlipped && (
          <View style={styles.swipeRatingHint}>
            <Text style={[theme.typography.caption, { color: RATING_COLORS.again }]}>{'\u2190'} {t('srsRating.again')}</Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>{t('session.swipeHint', { defaultValue: 'Swipe to rate' })}</Text>
            <Text style={[theme.typography.caption, { color: RATING_COLORS.good }]}>{t('srsRating.good')} {'\u2192'}</Text>
          </View>
        )}

        {/* Swipe hints */}
        {!isFlipped && (
          <View style={styles.swipeHints}>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, textAlign: 'center' }]}>
              {t('session.swipeHint')}
            </Text>
          </View>
        )}
      </Screen>
    </GestureHandlerRootView>
  )
}

function CardFace({ content, theme, scrollable = false }: { content: Array<{ key: string; value: string; style: string; name: string }>; theme: Theme; scrollable?: boolean }) {
  const inner = content.map((field) => (
    <View key={field.key} style={styles.fieldBlock}>
      <Text style={[
        field.style === 'primary' ? theme.typography.h2 : theme.typography.body,
        { color: theme.colors.text, textAlign: 'center' },
      ]}>
        {field.value}
      </Text>
    </View>
  ))

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


const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  progressBar: { height: 3, marginHorizontal: 20, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
  cardArea: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  cardContainer: { width: '100%', aspectRatio: 0.7, maxHeight: 480 },
  card: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 20, borderWidth: 1, padding: 24, justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 5,
  },
  cardBack: { },
  cardContent: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, width: '100%' },
  cardScrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 8 },
  fieldBlock: { width: '100%', alignItems: 'center' },
  tapHint: { position: 'absolute', bottom: 16 },
  swipeHint: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 20, zIndex: 10,
  },
  swipeRatingHint: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 32, paddingBottom: 20 },
  swipeHints: { paddingBottom: 24 },
  undoRow: { alignItems: 'center', paddingBottom: 8 },
  undoBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
})
