import { useEffect, useRef } from 'react'
import { View, Text, Animated, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { palette } from '../../theme'

interface LevelUpCelebrationProps {
  level: number
  visible: boolean
  onDismiss: () => void
}

/**
 * Level-up celebration overlay — matches web level-up animation.
 * Auto-dismisses after 2.5 seconds. Uses i18n for localization.
 */
export function LevelUpCelebration({ level, visible, onDismiss }: LevelUpCelebrationProps) {
  const { t } = useTranslation('dashboard')
  const scaleAnim = useRef(new Animated.Value(0)).current
  const opacityAnim = useRef(new Animated.Value(0)).current
  const starRotate = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!visible) return

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
        <Text style={styles.labelText}>{t('level.levelUp', { defaultValue: 'Level Up!' })}</Text>
        <Text style={styles.levelText}>{t('level.title', { level })}</Text>
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
