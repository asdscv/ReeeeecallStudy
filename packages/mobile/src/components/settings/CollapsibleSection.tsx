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
  icon,
  badge,
  defaultOpen = false,
  children,
  testID,
}: {
  title: string
  icon?: string
  badge?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
  testID?: string
}) {
  const theme = useTheme()
  const [open, setOpen] = useState(defaultOpen)
  const [mounted, setMounted] = useState(defaultOpen)

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity))
    setMounted(true)
    setOpen((v) => !v)
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
      <TouchableOpacity
        onPress={toggle}
        activeOpacity={0.6}
        style={styles.header}
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.headerLeft}>
          {icon ? (
            <View style={[styles.iconBadge, { backgroundColor: theme.colors.border }]}>
              <Text style={styles.icon}>{icon}</Text>
            </View>
          ) : null}
          <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>{title}</Text>
        </View>
        <View style={styles.headerRight}>
          {badge}
          <Text style={[styles.chevron, { color: theme.colors.textSecondary }]}>{open ? '⌄' : '›'}</Text>
        </View>
      </TouchableOpacity>
      {open && mounted && <View style={styles.body}>{children}</View>}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 15 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBadge: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 16 },
  title: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  chevron: { fontSize: 20, fontWeight: '400' },
  body: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 2 },
})
