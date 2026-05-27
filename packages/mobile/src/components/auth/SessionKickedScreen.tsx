import { useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, Animated, Easing, StyleSheet, Dimensions } from 'react-native'
import { useTranslation } from 'react-i18next'

const { width: W, height: H } = Dimensions.get('window')

const ORBS = [
  { x: 0.2, y: 0.2, size: 200, color: 'rgba(245,158,11,0.12)', dur: 8000 },
  { x: 0.8, y: 0.35, size: 160, color: 'rgba(239,68,68,0.08)', dur: 10000 },
  { x: 0.35, y: 0.7, size: 220, color: 'rgba(249,115,22,0.08)', dur: 12000 },
]

interface Props {
  onReclaim: () => void
  onLogout: () => void
}

export function SessionKickedScreen({ onReclaim, onLogout }: Props) {
  const { t } = useTranslation('common')
  const [reclaiming, setReclaiming] = useState(false)

  // Animations
  const cardSlide = useRef(new Animated.Value(0)).current
  const pulseAnim = useRef(new Animated.Value(1)).current
  const orbAnims = useRef(ORBS.map(() => new Animated.Value(0))).current

  useEffect(() => {
    // Card entrance
    Animated.timing(cardSlide, {
      toValue: 1, duration: 600, delay: 200,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start()

    // Shield pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start()

    // Orbs
    orbAnims.forEach((anim, i) => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: ORBS[i].dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: ORBS[i].dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ).start()
    })
  }, [])

  const cardTranslateY = cardSlide.interpolate({ inputRange: [0, 1], outputRange: [60, 0] })

  const handleReclaim = async () => {
    setReclaiming(true)
    await onReclaim()
    setReclaiming(false)
  }

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

      {/* Glass Card */}
      <Animated.View style={[s.card, { opacity: cardSlide, transform: [{ translateY: cardTranslateY }] }]}>
        {/* Top accent line */}
        <View style={s.accentLine} />

        {/* Shield illustration */}
        <View style={s.illustrationWrap}>
          {/* Central shield */}
          <View style={s.shieldBox}>
            <Animated.View style={[s.pulseRing, { transform: [{ scale: pulseAnim }] }]} />
            <Text style={s.shieldIcon}>🛡️</Text>
          </View>
          {/* Device icons */}
          <View style={[s.deviceIcon, { top: 4, right: 16 }]}>
            <Text style={s.deviceEmoji}>🖥️</Text>
          </View>
          <View style={[s.deviceIcon, { bottom: 12, left: 8 }]}>
            <Text style={s.deviceEmoji}>📱</Text>
          </View>
          {/* Disconnect line */}
          <View style={s.disconnectLine}>
            <View style={s.disconnectDot} />
          </View>
        </View>

        {/* Badge */}
        <View style={s.badge}>
          <Text style={s.badgeText}>📡 {t('sessionKicked.badge')}</Text>
        </View>

        {/* Headline */}
        <Text style={s.headline}>{t('sessionKicked.headline')}</Text>
        <Text style={s.description}>{t('sessionKicked.description')}</Text>

        {/* Info cards */}
        <View style={s.infoRow}>
          <View style={s.infoCard}>
            <Text style={s.infoIcon}>🖥️</Text>
            <Text style={s.infoText}>{t('sessionKicked.info1')}</Text>
          </View>
          <View style={s.infoCard}>
            <Text style={s.infoIcon}>🛡️</Text>
            <Text style={s.infoText}>{t('sessionKicked.info2')}</Text>
          </View>
        </View>

        {/* Reclaim button */}
        <TouchableOpacity
          style={s.reclaimBtn}
          onPress={handleReclaim}
          disabled={reclaiming}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={t('sessionKicked.reclaim')}
          accessibilityState={{ disabled: reclaiming, busy: reclaiming }}
        >
          <Text style={s.reclaimText}>
            {reclaiming ? t('sessionKicked.reclaiming') : t('sessionKicked.reclaim')}
          </Text>
        </TouchableOpacity>

        {/* Logout button */}
        <TouchableOpacity style={s.logoutBtn} onPress={onLogout} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={t('sessionKicked.logout')}>
          <Text style={s.logoutText}>→ {t('sessionKicked.logout')}</Text>
        </TouchableOpacity>

        {/* Hint */}
        <Text style={s.hint}>{t('sessionKicked.hint')}</Text>
      </Animated.View>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0f172a' },

  // Card
  card: {
    width: W * 0.88, borderRadius: 24, padding: 28, alignItems: 'center',
    backgroundColor: 'rgba(15,23,42,0.9)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    zIndex: 10,
  },
  accentLine: {
    position: 'absolute', top: 0, left: 20, right: 20, height: 2, borderRadius: 1,
    backgroundColor: 'rgba(245,158,11,0.5)',
  },

  // Shield illustration
  illustrationWrap: { width: 160, height: 160, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  shieldBox: {
    width: 80, height: 80, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,158,11,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  pulseRing: {
    position: 'absolute', width: 100, height: 100, borderRadius: 22,
    borderWidth: 2, borderColor: 'rgba(245,158,11,0.25)',
  },
  shieldIcon: { fontSize: 36 },
  deviceIcon: {
    position: 'absolute', width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  deviceEmoji: { fontSize: 16 },
  disconnectLine: {
    position: 'absolute', width: 100, height: 2, borderRadius: 1,
    backgroundColor: 'rgba(239,68,68,0.3)',
  },
  disconnectDot: {
    position: 'absolute', top: -3, left: '50%', marginLeft: -4,
    width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(239,68,68,0.6)',
  },

  // Badge
  badge: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16,
    backgroundColor: 'rgba(245,158,11,0.1)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.2)',
    marginBottom: 16,
  },
  badgeText: { fontSize: 12, color: 'rgba(245,158,11,0.9)', fontWeight: '600' },

  // Text
  headline: { fontSize: 24, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 8 },
  description: { fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 20, marginBottom: 20 },

  // Info cards
  infoRow: { flexDirection: 'row', gap: 10, marginBottom: 24, width: '100%' },
  infoCard: {
    flex: 1, alignItems: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 8, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  infoIcon: { fontSize: 20 },
  infoText: { fontSize: 11, color: 'rgba(255,255,255,0.4)', textAlign: 'center', lineHeight: 16 },

  // Buttons
  reclaimBtn: {
    width: '100%', paddingVertical: 16, borderRadius: 16, alignItems: 'center',
    backgroundColor: '#f59e0b',
    shadowColor: '#f59e0b', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12,
    marginBottom: 10,
  },
  reclaimText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  logoutBtn: {
    width: '100%', paddingVertical: 14, borderRadius: 16, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    marginBottom: 16,
  },
  logoutText: { fontSize: 14, fontWeight: '500', color: 'rgba(255,255,255,0.7)' },

  // Hint
  hint: { fontSize: 12, color: 'rgba(255,255,255,0.25)', textAlign: 'center' },
})
