import { useEffect, useRef, useState } from 'react'
import { View, Text, Animated, StyleSheet, Dimensions } from 'react-native'
import { palette } from '../../theme'

interface LevelUpCelebrationProps {
  level: number
  visible: boolean
  onDismiss: () => void
}

const { width: SCREEN_WIDTH } = Dimensions.get('window')

/**
 * Matches web level-up celebration — star animation + "레벨 업!" overlay.
 * Auto-dismisses after 2.5 seconds.
 */
export function LevelUpCelebration({ level, visible, onDismiss }: LevelUpCelebrationProps) {
  const scaleAnim = useRef(new Animated.Value(0)).current
  const opacityAnim = useRef(new Animated.Value(0)).current
  const starRotate = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!visible) return

    // Entrance animation
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 4,
        tension: 60,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.loop(
        Animated.timing(starRotate, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: true,
        }),
      ),
    ]).start()

    // Auto-dismiss
    const timer = setTimeout(() => {
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => {
        scaleAnim.setValue(0)
        starRotate.setValue(0)
        onDismiss()
      })
    }, 2500)

    return () => clearTimeout(timer)
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null

  const spin = starRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  })

  return (
    <Animated.View style={[styles.overlay, { opacity: opacityAnim }]} pointerEvents="none">
      <Animated.View style={[styles.content, { transform: [{ scale: scaleAnim }] }]}>
        <Animated.Text style={[styles.star, { transform: [{ rotate: spin }] }]}>
          {'\u2B50'}
        </Animated.Text>
        <Text style={styles.labelText}>레벨 업!</Text>
        <Text style={styles.levelText}>레벨 {level}</Text>
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    zIndex: 999,
  },
  content: {
    alignItems: 'center',
    gap: 4,
  },
  star: {
    fontSize: 64,
    textShadowColor: 'rgba(234,179,8,0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  labelText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  levelText: {
    fontSize: 42,
    fontWeight: '900',
    color: palette.yellow[400],
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 8,
  },
})
