import { useEffect, useRef, useState } from 'react'
import { View, Image, Text, Animated, Easing, StyleSheet, Dimensions } from 'react-native'
import { palette } from '../../theme'

const { width: W, height: H } = Dimensions.get('window')
const CARD_W = W * 0.72
const CARD_H = CARD_W * 0.62

const FLIP_FIRST = 700
const FLIP_INTERVAL = 2000
const RATING_LABELS = ['Again', 'Hard', 'Good', 'Easy']
const RATING_COLORS = ['#ef4444', '#f97316', '#10b981', '#3b82f6']

// Floating orbs
const ORBS = [
  { x: 0.12, y: 0.18, size: 180, color: 'rgba(59,130,246,0.15)', dur: 8000 },
  { x: 0.75, y: 0.12, size: 130, color: 'rgba(168,85,247,0.12)', dur: 10000 },
  { x: 0.5, y: 0.78, size: 200, color: 'rgba(34,211,238,0.10)', dur: 12000 },
]

/**
 * Premium loading screen — card flip animation like web AuthGuard.
 * Dark bg, floating orbs, 3D card flip, rating buttons, then fade to app.
 */
export function LoadingScreen() {
  const [isFlipped, setIsFlipped] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(-1)

  // Animations
  const flipAnim = useRef(new Animated.Value(0)).current  // 0=front, 1=back
  const logoOpacity = useRef(new Animated.Value(0)).current
  const cardOpacity = useRef(new Animated.Value(0)).current
  const ratingOpacity = useRef(new Animated.Value(0)).current
  const orbAnims = useRef(ORBS.map(() => new Animated.Value(0))).current

  // Logo + card entrance
  useEffect(() => {
    Animated.sequence([
      Animated.timing(logoOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start()

    // Rating buttons fade in
    Animated.timing(ratingOpacity, {
      toValue: 1, duration: 500, delay: 800, useNativeDriver: true,
    }).start()

    // Orb floating
    orbAnims.forEach((anim, i) => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: ORBS[i].dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: ORBS[i].dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ).start()
    })
  }, [])

  // Card flip loop
  useEffect(() => {
    const firstTimer = setTimeout(() => {
      setIsFlipped(true)
    }, FLIP_FIRST)

    const interval = setInterval(() => {
      setIsFlipped(prev => !prev)
    }, FLIP_FIRST + FLIP_INTERVAL)

    return () => { clearTimeout(firstTimer); clearInterval(interval) }
  }, [])

  // Animate flip
  useEffect(() => {
    Animated.timing(flipAnim, {
      toValue: isFlipped ? 1 : 0,
      duration: 700,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start()
  }, [isFlipped])

  // Rating sweep when flipped to back
  useEffect(() => {
    if (!isFlipped) { setHighlightIdx(-1); return }
    let idx = 0
    const sweep = setInterval(() => {
      setHighlightIdx(idx)
      idx++
      if (idx >= RATING_LABELS.length) clearInterval(sweep)
    }, 250)
    return () => clearInterval(sweep)
  }, [isFlipped])

  // Card transforms
  const frontRotate = flipAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] })
  const backRotate = flipAnim.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] })
  const frontOpacity = flipAnim.interpolate({ inputRange: [0, 0.5, 0.5, 1], outputRange: [1, 1, 0, 0] })
  const backOpacity = flipAnim.interpolate({ inputRange: [0, 0.5, 0.5, 1], outputRange: [0, 0, 1, 1] })

  return (
    <View style={s.container}>
      <View style={s.bg} />

      {/* Orbs */}
      {ORBS.map((orb, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: orb.size, height: orb.size, borderRadius: orb.size / 2,
            backgroundColor: orb.color,
            left: orb.x * W - orb.size / 2,
            top: orb.y * H - orb.size / 2,
            transform: [{ translateY: orbAnims[i].interpolate({ inputRange: [0, 1], outputRange: [0, -20] }) }],
            opacity: orbAnims[i].interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 1, 0.5] }),
          }}
        />
      ))}

      <View style={s.content}>
        {/* Logo */}
        <Animated.View style={[s.logoRow, { opacity: logoOpacity }]}>
          <Image source={require('../../../assets/logo-icon.png')} style={s.logoIcon} resizeMode="contain" />
          <Image source={require('../../../assets/logo-text.png')} style={s.logoText} resizeMode="contain" />
        </Animated.View>

        {/* Tagline pill */}
        <Animated.View style={[s.pill, { opacity: logoOpacity }]}>
          <Text style={s.pillText}>Smart Flashcard Learning Platform</Text>
        </Animated.View>

        {/* Card flip area */}
        <Animated.View style={[s.cardArea, { opacity: cardOpacity }]}>
          {/* Glow under card */}
          <View style={s.cardGlow} />

          {/* Front */}
          <Animated.View style={[s.card, { transform: [{ perspective: 1200 }, { rotateY: frontRotate }], opacity: frontOpacity }]}>
            <View style={s.cardBadge}><Text style={s.cardBadgeText}>Q</Text></View>
            <Text style={s.cardMainText}>Hello</Text>
            <Text style={s.cardSubText}>Tap to reveal</Text>
          </Animated.View>

          {/* Back */}
          <Animated.View style={[s.card, s.cardBack, { transform: [{ perspective: 1200 }, { rotateY: backRotate }], opacity: backOpacity }]}>
            <View style={s.cardBadge}><Text style={s.cardBadgeText}>A</Text></View>
            <Text style={s.cardMainText}>Bonjour</Text>
            <Text style={s.cardMeaningText}>Hello (French)</Text>
            <Text style={s.cardExampleText}>"Bonjour, comment allez-vous?"</Text>
          </Animated.View>
        </Animated.View>

        {/* Rating buttons */}
        <Animated.View style={[s.ratingRow, { opacity: ratingOpacity }]}>
          {RATING_LABELS.map((label, i) => (
            <View
              key={label}
              style={[
                s.ratingBtn,
                highlightIdx === i
                  ? { backgroundColor: RATING_COLORS[i], transform: [{ scale: 1.1 }] }
                  : { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
              ]}
            >
              <Text style={[s.ratingText, highlightIdx === i && { color: '#fff', fontWeight: '700' }]}>
                {label}
              </Text>
            </View>
          ))}
        </Animated.View>

        {/* Progress bar */}
        <Animated.View style={[s.progressWrap, { opacity: ratingOpacity }]}>
          <View style={s.progressRow}>
            <Text style={s.progressLabel}>12/30 cards</Text>
            <Text style={s.progressPct}>40%</Text>
          </View>
          <View style={s.progressTrack}>
            <View style={s.progressFill} />
          </View>
        </Animated.View>

        {/* Loading dots */}
        <LoadingDots />
      </View>
    </View>
  )
}

function LoadingDots() {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current

  useEffect(() => {
    dots.forEach((dot, i) => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(dot, { toValue: 1, duration: 400, delay: i * 150, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ).start()
    })
  }, [])

  return (
    <View style={s.dotsRow}>
      {dots.map((dot, i) => (
        <Animated.View key={i} style={[s.dot, { opacity: dot }]} />
      ))}
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0f172a' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, zIndex: 10 },

  // Logo
  logoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 16, width: '100%' },
  logoIcon: { width: 56, height: 56 },
  logoText: { height: 56, width: W * 0.6, tintColor: '#e2e8f0' },

  // Pill
  pill: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, backgroundColor: 'rgba(59,130,246,0.1)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.2)', marginBottom: 24 },
  pillText: { fontSize: 12, color: 'rgba(59,130,246,0.7)', fontWeight: '500', letterSpacing: 0.5 },

  // Card area
  cardArea: { width: CARD_W, height: CARD_H, marginBottom: 20 },
  cardGlow: { position: 'absolute', bottom: -12, left: '15%', width: '70%', height: 24, borderRadius: 12, backgroundColor: 'rgba(59,130,246,0.15)' },
  card: {
    position: 'absolute', width: '100%', height: '100%',
    borderRadius: 20, alignItems: 'center', justifyContent: 'center', padding: 20,
    // Front gradient: blue
    backgroundColor: '#3b82f6',
    shadowColor: '#3b82f6', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 8,
    backfaceVisibility: 'hidden',
  },
  cardBack: {
    // Back gradient: emerald → cyan
    backgroundColor: '#06b6d4',
    shadowColor: '#06b6d4',
  },
  cardBadge: { position: 'absolute', top: 12, right: 12, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.1)' },
  cardBadgeText: { fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },
  cardMainText: { fontSize: 36, fontWeight: '800', color: '#fff' },
  cardSubText: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 8 },
  cardMeaningText: { fontSize: 15, color: 'rgba(255,255,255,0.7)', fontWeight: '600', marginTop: 8 },
  cardExampleText: { fontSize: 12, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', marginTop: 4 },

  // Rating
  ratingRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  ratingBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  ratingText: { fontSize: 13, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },

  // Progress
  progressWrap: { width: CARD_W, marginBottom: 24 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { fontSize: 11, color: 'rgba(255,255,255,0.35)' },
  progressPct: { fontSize: 11, color: 'rgba(59,130,246,0.6)' },
  progressTrack: { width: '100%', height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.05)' },
  progressFill: { width: '40%', height: 5, borderRadius: 3, backgroundColor: palette.blue[500] },

  // Dots
  dotsRow: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.blue[400] },
})
