import { useEffect } from 'react'
import { View, Text, TouchableOpacity, Dimensions, StyleSheet, Alert } from 'react-native'
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
import { useStudy } from '../hooks/useStudy'
import { useTheme, type Theme } from '../theme'
import type { StudyStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<StudyStackParamList, 'StudySession'>

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25
const VELOCITY_THRESHOLD = 500

const RATING_COLORS: Record<string, string> = {
  again: '#EF4444',
  hard: '#F59E0B',
  good: '#22C55E',
  easy: '#3B82F6',
}

export function StudySessionScreen() {
  const theme = useTheme()
  const navigation = useNavigation<Nav>()
  const {
    phase, currentCard, isFlipped, isRating, template,
    sessionStats, progress, flipCard, rateCard, exitSession,
  } = useStudy()

  // Animation values
  const rotateY = useSharedValue(0)
  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)
  const cardScale = useSharedValue(1)

  // Navigate to summary when complete
  useEffect(() => {
    if (phase === 'completed') {
      navigation.replace('StudySummary')
    }
  }, [phase, navigation])

  // Reset flip on card change
  useEffect(() => {
    rotateY.value = 0
    translateX.value = 0
    translateY.value = 0
    cardScale.value = 1
  }, [currentCard?.id])

  // Sync flip animation with state
  useEffect(() => {
    rotateY.value = withTiming(isFlipped ? 180 : 0, { duration: 300 })
  }, [isFlipped])

  if (!currentCard || phase !== 'studying') {
    return (
      <Screen testID="study-session-screen">
        <View style={styles.center}>
          <Text style={[theme.typography.h3, { color: theme.colors.textSecondary }]}>Loading...</Text>
        </View>
      </Screen>
    )
  }

  // Card content
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

  const handleExit = () => {
    Alert.alert('End Session?', 'Your progress so far will be saved.', [
      { text: 'Continue', style: 'cancel' },
      { text: 'End', style: 'destructive', onPress: () => exitSession() },
    ])
  }

  // Swipe gesture
  const gesture = Gesture.Pan()
    .enabled(!isRating)
    .onUpdate((e) => {
      translateX.value = e.translationX
      translateY.value = e.translationY
      cardScale.value = interpolate(
        Math.abs(e.translationX) + Math.abs(e.translationY),
        [0, SCREEN_WIDTH],
        [1, 0.85],
        Extrapolation.CLAMP,
      )
    })
    .onEnd((e) => {
      const { translationX: tx, translationY: ty, velocityX: vx } = e

      if (tx < -SWIPE_THRESHOLD || vx < -VELOCITY_THRESHOLD) {
        translateX.value = withTiming(-SCREEN_WIDTH)
        runOnJS(handleRate)('again')
      } else if (tx > SWIPE_THRESHOLD || vx > VELOCITY_THRESHOLD) {
        translateX.value = withTiming(SCREEN_WIDTH)
        runOnJS(handleRate)('good')
      } else if (ty < -SWIPE_THRESHOLD) {
        translateY.value = withTiming(-SCREEN_WIDTH)
        runOnJS(handleRate)('easy')
      } else if (ty > SWIPE_THRESHOLD) {
        translateY.value = withTiming(SCREEN_WIDTH)
        runOnJS(handleRate)('hard')
      } else {
        translateX.value = withSpring(0)
        translateY.value = withSpring(0)
        cardScale.value = withSpring(1)
      }
    })

  // Animated styles
  const cardAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: cardScale.value },
    ],
  }))

  const frontAnimStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${rotateY.value}deg` }],
    backfaceVisibility: 'hidden' as const,
    opacity: interpolate(rotateY.value, [0, 90, 180], [1, 0, 0]),
  }))

  const backAnimStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${rotateY.value - 180}deg` }],
    backfaceVisibility: 'hidden' as const,
    opacity: interpolate(rotateY.value, [0, 90, 180], [0, 0, 1]),
  }))

  // Swipe hint overlay
  const hintStyle = useAnimatedStyle(() => {
    const absX = Math.abs(translateX.value)
    const absY = Math.abs(translateY.value)
    const opacity = interpolate(Math.max(absX, absY), [0, SWIPE_THRESHOLD], [0, 0.8], Extrapolation.CLAMP)
    let color = 'transparent'
    if (translateX.value < -30) color = RATING_COLORS.again
    else if (translateX.value > 30) color = RATING_COLORS.good
    else if (translateY.value < -30) color = RATING_COLORS.easy
    else if (translateY.value > 30) color = RATING_COLORS.hard
    return { opacity, backgroundColor: color }
  })

  return (
    <GestureHandlerRootView style={styles.flex}>
      <Screen safeArea padding={false} testID="study-session-screen">
        {/* Header */}
        <View style={[styles.header, { paddingHorizontal: 20 }]}>
          <TouchableOpacity onPress={handleExit} testID="study-exit-button">
            <Text style={[theme.typography.body, { color: theme.colors.primary }]}>✕ Exit</Text>
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
        <View style={styles.cardArea}>
          <GestureDetector gesture={gesture}>
            <Animated.View style={[styles.cardContainer, cardAnimStyle]}>
              {/* Swipe hint overlay */}
              <Animated.View style={[styles.swipeHint, hintStyle]} />

              <TouchableOpacity activeOpacity={0.95} onPress={handleFlip} testID="study-card-tap">
                {/* Front face */}
                <Animated.View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }, frontAnimStyle]}>
                  <CardFace content={fallbackFront} theme={theme} />
                  <Text style={[theme.typography.caption, styles.tapHint, { color: theme.colors.textTertiary }]}>
                    Tap to flip
                  </Text>
                </Animated.View>

                {/* Back face */}
                <Animated.View style={[styles.card, styles.cardBack, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }, backAnimStyle]}>
                  <CardFace content={fallbackBack} theme={theme} />
                </Animated.View>
              </TouchableOpacity>
            </Animated.View>
          </GestureDetector>
        </View>

        {/* Rating buttons (visible after flip) */}
        {isFlipped && (
          <View style={[styles.ratingRow, { paddingHorizontal: 16 }]}>
            <RatingButton label="Again" color={RATING_COLORS.again} onPress={() => handleRate('again')} disabled={isRating} testID="study-rate-again" />
            <RatingButton label="Hard" color={RATING_COLORS.hard} onPress={() => handleRate('hard')} disabled={isRating} testID="study-rate-hard" />
            <RatingButton label="Good" color={RATING_COLORS.good} onPress={() => handleRate('good')} disabled={isRating} testID="study-rate-good" />
            <RatingButton label="Easy" color={RATING_COLORS.easy} onPress={() => handleRate('easy')} disabled={isRating} testID="study-rate-easy" />
          </View>
        )}

        {/* Swipe hints */}
        {!isFlipped && (
          <View style={styles.swipeHints}>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, textAlign: 'center' }]}>
              Tap card to flip · Swipe to rate
            </Text>
          </View>
        )}
      </Screen>
    </GestureHandlerRootView>
  )
}

function CardFace({ content, theme }: { content: Array<{ key: string; value: string; style: string; name: string }>; theme: Theme }) {
  return (
    <View style={styles.cardContent}>
      {content.map((field) => (
        <View key={field.key} style={styles.fieldBlock}>
          <Text style={[
            field.style === 'primary' ? theme.typography.h2 : theme.typography.body,
            { color: theme.colors.text, textAlign: 'center' },
          ]}>
            {field.value}
          </Text>
        </View>
      ))}
    </View>
  )
}

function RatingButton({ label, color, onPress, disabled, testID }: {
  label: string; color: string; onPress: () => void; disabled: boolean; testID: string
}) {
  return (
    <TouchableOpacity
      testID={testID}
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
  cardContainer: { width: '100%', aspectRatio: 0.7, maxHeight: 480 },
  card: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 20, borderWidth: 1, padding: 24, justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 5,
  },
  cardBack: { },
  cardContent: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, width: '100%' },
  fieldBlock: { width: '100%', alignItems: 'center' },
  tapHint: { position: 'absolute', bottom: 16 },
  swipeHint: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 20, zIndex: 10,
  },
  ratingRow: { flexDirection: 'row', gap: 8, paddingBottom: 24 },
  ratingBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  ratingLabel: { color: '#fff', fontWeight: '700', fontSize: 14 },
  swipeHints: { paddingBottom: 24 },
})
