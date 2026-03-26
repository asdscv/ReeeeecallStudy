import { useEffect, useRef } from 'react'
import { View, Image, Text, Animated, Easing, StyleSheet, Dimensions } from 'react-native'
import { palette } from '../../theme'

const { width, height } = Dimensions.get('window')

// Floating orb positions (relative to screen)
const ORBS = [
  { x: 0.15, y: 0.25, size: 160, color: 'rgba(59,130,246,0.15)', duration: 8000 },
  { x: 0.7, y: 0.15, size: 120, color: 'rgba(168,85,247,0.12)', duration: 10000 },
  { x: 0.5, y: 0.7, size: 180, color: 'rgba(34,211,238,0.10)', duration: 12000 },
  { x: 0.85, y: 0.6, size: 100, color: 'rgba(59,130,246,0.08)', duration: 9000 },
]

/**
 * Premium loading screen — matches web AuthGuard visual language.
 * Dark gradient bg, floating orbs, breathing logo with glow, branded text.
 */
export function LoadingScreen() {
  // Logo breathing animation
  const logoScale = useRef(new Animated.Value(0.8)).current
  const logoOpacity = useRef(new Animated.Value(0)).current

  // Text fade-in
  const textOpacity = useRef(new Animated.Value(0)).current
  const textTranslateY = useRef(new Animated.Value(12)).current

  // Orb floating animations
  const orbAnims = useRef(ORBS.map(() => new Animated.Value(0))).current

  useEffect(() => {
    // Logo entrance
    Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(logoScale, {
        toValue: 1,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start()

    // Logo breathing loop
    Animated.loop(
      Animated.sequence([
        Animated.timing(logoScale, {
          toValue: 1.06,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start()

    // Text stagger entrance
    Animated.parallel([
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: 600,
        delay: 400,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(textTranslateY, {
        toValue: 0,
        duration: 600,
        delay: 400,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start()

    // Floating orbs
    orbAnims.forEach((anim, i) => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1,
            duration: ORBS[i].duration,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: ORBS[i].duration,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ).start()
    })
  }, [])

  return (
    <View style={styles.container}>
      {/* Dark gradient background layers */}
      <View style={styles.bgBase} />
      <View style={styles.bgGradient} />

      {/* Floating orbs */}
      {ORBS.map((orb, i) => (
        <Animated.View
          key={i}
          style={[
            styles.orb,
            {
              width: orb.size,
              height: orb.size,
              borderRadius: orb.size / 2,
              backgroundColor: orb.color,
              left: orb.x * width - orb.size / 2,
              top: orb.y * height - orb.size / 2,
              transform: [{
                translateY: orbAnims[i].interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -20],
                }),
              }],
              opacity: orbAnims[i].interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [0.6, 1, 0.6],
              }),
            },
          ]}
        />
      ))}

      {/* Center content */}
      <View style={styles.content}>
        {/* Logo with glow */}
        <Animated.View style={[styles.logoWrap, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}>
          <View style={styles.logoGlow} />
          <Image
            source={require('../../../assets/logo-icon.png')}
            style={styles.logoIcon}
            resizeMode="contain"
          />
        </Animated.View>

        {/* Brand text */}
        <Animated.View style={[styles.textWrap, { opacity: textOpacity, transform: [{ translateY: textTranslateY }] }]}>
          <Image
            source={require('../../../assets/logo-text.png')}
            style={styles.logoText}
            resizeMode="contain"
          />
          <Text style={styles.tagline}>Smart flashcards, powered by AI</Text>
        </Animated.View>

        {/* Loading dots */}
        <Animated.View style={[styles.dotsRow, { opacity: textOpacity }]}>
          <LoadingDots />
        </Animated.View>
      </View>
    </View>
  )
}

/** Animated 3-dot loader */
function LoadingDots() {
  const dot1 = useRef(new Animated.Value(0.3)).current
  const dot2 = useRef(new Animated.Value(0.3)).current
  const dot3 = useRef(new Animated.Value(0.3)).current

  useEffect(() => {
    const animate = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(dot, { toValue: 1, duration: 400, delay, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      )
    animate(dot1, 0).start()
    animate(dot2, 150).start()
    animate(dot3, 300).start()
  }, [])

  return (
    <>
      {[dot1, dot2, dot3].map((dot, i) => (
        <Animated.View key={i} style={[styles.dot, { opacity: dot }]} />
      ))}
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  bgBase: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0f172a' },
  bgGradient: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    // Simulated gradient via overlapping layers
    borderTopWidth: 0,
    opacity: 0.7,
  },
  orb: { position: 'absolute' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28, zIndex: 10 },
  logoWrap: { alignItems: 'center', justifyContent: 'center' },
  logoGlow: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(59,130,246,0.2)',
  },
  logoIcon: { width: 80, height: 80 },
  textWrap: { alignItems: 'center', gap: 8 },
  logoText: { height: 28, width: 170, tintColor: '#e2e8f0' },
  tagline: { fontSize: 14, color: 'rgba(148,163,184,0.8)', letterSpacing: 0.3 },
  dotsRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.blue[400] },
})
