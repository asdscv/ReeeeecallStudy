import { useState, type ReactNode } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, LayoutAnimation, Platform, UIManager } from 'react-native'
import { useTheme } from '../../theme'

// Enable LayoutAnimation on Android (no-op on iOS, where it's on by default).
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

/**
 * Accordion section for the mobile Settings screen — smooth expand/collapse via
 * LayoutAnimation. Header (icon badge + title + optional right badge) toggles the
 * body; children mount lazily on first open. Mirrors the web CollapsibleSection.
 */
export function CollapsibleSection({
  title,
  subtitle,
  icon,
  tint,
  badge,
  defaultOpen = false,
  children,
  testID,
}: {
  title: string
  subtitle?: string
  icon?: string
  /** Accent color for the icon tile (6-digit hex). Gives each section a subtle,
   *  consistent color identity — the signature grouped-settings look. */
  tint?: string
  badge?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
  testID?: string
}) {
  const theme = useTheme()
  const [open, setOpen] = useState(defaultOpen)
  const [mounted, setMounted] = useState(defaultOpen)

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity))
    setMounted(true)
    setOpen((v) => !v)
  }

  // Soft-tinted icon tile: the accent color at low alpha over the card, so the
  // emoji reads on a gentle wash of its section's color (works in light & dark).
  const tileBg = tint ? tint + '24' : theme.colors.border

  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
      <TouchableOpacity
        onPress={toggle}
        activeOpacity={0.7}
        style={styles.header}
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.headerLeft}>
          {icon ? (
            <View style={[styles.iconBadge, { backgroundColor: tileBg }]}>
              <Text style={styles.icon}>{icon}</Text>
            </View>
          ) : null}
          <View style={styles.titleWrap}>
            <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>{title}</Text>
            {subtitle ? (
              <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]} numberOfLines={1}>{subtitle}</Text>
            ) : null}
          </View>
        </View>
        <View style={styles.headerRight}>
          {badge}
          <Text style={[styles.chevron, { color: theme.colors.textTertiary, transform: [{ rotate: open ? '90deg' : '0deg' }] }]}>›</Text>
        </View>
      </TouchableOpacity>
      {open && mounted && <View style={[styles.body, { borderTopColor: theme.colors.border }]}>{children}</View>}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
    overflow: 'hidden',
    // Subtle depth (iOS-native settings feel). No-op visual weight on Android.
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBadge: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 17 },
  titleWrap: { flexShrink: 1, gap: 1 },
  title: { fontSize: 15.5, fontWeight: '600', flexShrink: 1, letterSpacing: -0.2 },
  subtitle: { fontSize: 12.5, fontWeight: '400' },
  chevron: { fontSize: 22, fontWeight: '500' },
  body: { paddingHorizontal: 14, paddingBottom: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 2 },
})
