import { useEffect, useRef, useState } from 'react'
import { View, Image, Text, Animated, Easing, StyleSheet, Dimensions, TouchableOpacity } from 'react-native'
import { palette } from '../../theme'

const { width: W, height: H } = Dimensions.get('window')
const CARD_W = W * 0.68
const CARD_H = CARD_W * 0.58

const FLIP_INTERVAL = 1200
const RATING_LABELS = ['Again', 'Hard', 'Good', 'Easy']
const RATING_COLORS = ['#ef4444', '#f97316', '#10b981', '#3b82f6']

const ORBS = [
  { x: 0.12, y: 0.18, size: 180, color: 'rgba(59,130,246,0.15)', dur: 8000 },
  { x: 0.75, y: 0.12, size: 130, color: 'rgba(168,85,247,0.12)', dur: 10000 },
  { x: 0.5, y: 0.78, size: 200, color: 'rgba(34,211,238,0.10)', dur: 12000 },
]

const FEATURES = [
  { icon: '🧠', label: 'SRS 알고리즘' },
  { icon: '📊', label: '학습 통계' },
  { icon: '∞', label: '무제한 덱' },
]

interface Props {
  onLogin: () => void
}

/**
 * Mobile AuthGuard — matches web AuthGuardOverlay.
 * Card flip preview blurs, then glass CTA card slides up.
 */
export function AuthGuardScreen({ onLogin }: Props) {
  const [isFlipped, setIsFlipped] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(-1)

  // Animations
  const flipAnim = useRef(new Animated.Value(0)).current
  const previewBlur = useRef(new Animated.Value(1)).current  // 1=clear, 0=faded
  const ctaSlide = useRef(new Animated.Value(0)).current     // 0=hidden, 1=shown
  const orbAnims = useRef(ORBS.map(() => new Animated.Value(0))).current

  // Entrance: show preview, then blur + reveal CTA
  useEffect(() => {
    // After 2s, blur preview and show CTA
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(previewBlur, { toValue: 0.2, duration: 800, useNativeDriver: true }),
        Animated.timing(ctaSlide, { toValue: 1, duration: 600, delay: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start()
    }, 2000)

    // Orbs
    orbAnims.forEach((anim, i) => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: ORBS[i].dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: ORBS[i].dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ).start()
    })

    return () => clearTimeout(timer)
  }, [])

  // Card flip loop
  useEffect(() => {
    const firstTimer = setTimeout(() => setIsFlipped(true), 600)
    const interval = setInterval(() => setIsFlipped(prev => !prev), FLIP_INTERVAL)
    return () => { clearTimeout(firstTimer); clearInterval(interval) }
  }, [])

  // Animate flip
  useEffect(() => {
    Animated.timing(flipAnim, {
      toValue: isFlipped ? 1 : 0,
      duration: 600,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start()
  }, [isFlipped])

  // Rating sweep
  useEffect(() => {
    if (!isFlipped) { setHighlightIdx(-1); return }
    let idx = 0
    const sweep = setInterval(() => {
      setHighlightIdx(idx)
      idx++
      if (idx >= RATING_LABELS.length) clearInterval(sweep)
    }, 200)
    return () => clearInterval(sweep)
  }, [isFlipped])

  const frontRotate = flipAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] })
  const backRotate = flipAnim.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] })
  const frontOpacity = flipAnim.interpolate({ inputRange: [0, 0.5, 0.5, 1], outputRange: [1, 1, 0, 0] })
  const backOpacity = flipAnim.interpolate({ inputRange: [0, 0.5, 0.5, 1], outputRange: [0, 0, 1, 1] })

  const ctaTranslateY = ctaSlide.interpolate({ inputRange: [0, 1], outputRange: [60, 0] })

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

      {/* Card preview (blurs out) */}
      <Animated.View style={[s.previewWrap, { opacity: previewBlur }]}>
        {/* Card */}
        <View style={s.cardArea}>
          <Animated.View style={[s.card, { transform: [{ perspective: 1200 }, { rotateY: frontRotate }], opacity: frontOpacity }]}>
            <View style={s.cardBadge}><Text style={s.cardBadgeText}>Q</Text></View>
            <Text style={s.cardMainText}>Hello</Text>
            <Text style={s.cardSubText}>Tap to reveal</Text>
          </Animated.View>
          <Animated.View style={[s.card, s.cardBack, { transform: [{ perspective: 1200 }, { rotateY: backRotate }], opacity: backOpacity }]}>
            <View style={s.cardBadge}><Text style={s.cardBadgeText}>A</Text></View>
            <Text style={s.cardMainText}>Bonjour</Text>
            <Text style={s.cardMeaningText}>Hello (French)</Text>
            <Text style={s.cardExampleText}>"Bonjour, comment allez-vous?"</Text>
          </Animated.View>
        </View>

        {/* Rating */}
        <View style={s.ratingRow}>
          {RATING_LABELS.map((label, i) => (
            <View
              key={label}
              style={[
                s.ratingBtn,
                highlightIdx === i
                  ? { backgroundColor: RATING_COLORS[i] }
                  : { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
              ]}
            >
              <Text style={[s.ratingText, highlightIdx === i && { color: '#fff', fontWeight: '700' }]}>{label}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* CTA Glass Card (slides up after preview blurs) */}
      <Animated.View style={[s.ctaWrap, { opacity: ctaSlide, transform: [{ translateY: ctaTranslateY }] }]}>
        <View style={s.ctaCard}>
          {/* Logo */}
          <View style={s.ctaLogoRow}>
            <View style={s.ctaLogoGlow} />
            <Image source={require('../../../assets/logo-icon.png')} style={s.ctaLogoIcon} resizeMode="contain" />
          </View>
          <Image source={require('../../../assets/logo-text.png')} style={s.ctaLogoText} resizeMode="contain" />

          {/* Headline */}
          <Text style={s.ctaHeadline}>과학적으로 학습하세요</Text>
          <Text style={s.ctaSubtext}>SRS 알고리즘 기반으로 효율적으로 암기하세요.{'\n'}지금 시작하세요.</Text>

          {/* Features */}
          <View style={s.featRow}>
            {FEATURES.map((f) => (
              <View key={f.label} style={s.featItem}>
                <Text style={s.featIcon}>{f.icon}</Text>
                <Text style={s.featLabel}>{f.label}</Text>
              </View>
            ))}
          </View>

          {/* CTA Buttons */}
          <TouchableOpacity style={s.ctaPrimary} onPress={onLogin} activeOpacity={0.8}>
            <Text style={s.ctaPrimaryText}>시작하기 →</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.ctaSecondary} onPress={onLogin} activeOpacity={0.7}>
            <Text style={s.ctaSecondaryText}>이미 계정이 있어요</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0f172a' },

  // Preview (card flip area — positioned in center-top)
  previewWrap: { position: 'absolute', top: H * 0.15, left: 0, right: 0, alignItems: 'center', zIndex: 5 },
  cardArea: { width: CARD_W, height: CARD_H, marginBottom: 16 },
  card: {
    position: 'absolute', width: '100%', height: '100%',
    borderRadius: 20, alignItems: 'center', justifyContent: 'center', padding: 20,
    backgroundColor: '#3b82f6',
    shadowColor: '#3b82f6', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 8,
    backfaceVisibility: 'hidden',
  },
  cardBack: { backgroundColor: '#06b6d4', shadowColor: '#06b6d4' },
  cardBadge: { position: 'absolute', top: 12, right: 12, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.1)' },
  cardBadgeText: { fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },
  cardMainText: { fontSize: 34, fontWeight: '800', color: '#fff' },
  cardSubText: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 6 },
  cardMeaningText: { fontSize: 15, color: 'rgba(255,255,255,0.7)', fontWeight: '600', marginTop: 6 },
  cardExampleText: { fontSize: 12, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', marginTop: 4 },
  ratingRow: { flexDirection: 'row', gap: 8 },
  ratingBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  ratingText: { fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },

  // CTA Card (glass overlay)
  ctaWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', paddingHorizontal: 20, paddingBottom: 50, zIndex: 20 },
  ctaCard: {
    width: '100%', borderRadius: 24, padding: 28, alignItems: 'center',
    backgroundColor: 'rgba(15,23,42,0.85)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },

  // CTA Logo
  ctaLogoRow: { marginBottom: 6, alignItems: 'center', justifyContent: 'center' },
  ctaLogoGlow: { position: 'absolute', width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(59,130,246,0.3)' },
  ctaLogoIcon: { width: 40, height: 40 },
  ctaLogoText: { height: 16, width: 120, tintColor: '#e2e8f0', marginBottom: 16 },

  // CTA Text
  ctaHeadline: { fontSize: 26, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 8 },
  ctaSubtext: { fontSize: 14, color: 'rgba(147,197,253,0.8)', textAlign: 'center', lineHeight: 20, marginBottom: 20 },

  // Features
  featRow: { flexDirection: 'row', gap: 10, marginBottom: 24, width: '100%' },
  featItem: {
    flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  featIcon: { fontSize: 22 },
  featLabel: { fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: '600' },

  // Buttons
  ctaPrimary: {
    width: '100%', paddingVertical: 16, borderRadius: 14, alignItems: 'center',
    backgroundColor: '#3b82f6',
    shadowColor: '#3b82f6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12,
    marginBottom: 10,
  },
  ctaPrimaryText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  ctaSecondary: {
    width: '100%', paddingVertical: 14, borderRadius: 14, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  ctaSecondaryText: { fontSize: 15, fontWeight: '500', color: 'rgba(255,255,255,0.8)' },
})
