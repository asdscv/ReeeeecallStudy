import { useState, type ReactNode } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useTheme } from '../../theme'

/**
 * Accordion section for the mobile Settings screen. Header (icon + title + optional
 * right badge) toggles the body open/closed. Defaults to collapsed. Mirrors the web
 * CollapsibleSection + the SettingsScreen SectionCard styling.
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
  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.7}
        style={styles.header}
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.headerLeft}>
          {icon ? <Text style={styles.icon}>{icon}</Text> : null}
          <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>{title}</Text>
        </View>
        <View style={styles.headerRight}>
          {badge}
          <Text style={[styles.chevron, { color: theme.colors.textSecondary }]}>{open ? '▾' : '▸'}</Text>
        </View>
      </TouchableOpacity>
      {open && <View style={styles.body}>{children}</View>}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, marginBottom: 12, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { fontSize: 16 },
  title: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  chevron: { fontSize: 16, fontWeight: '600' },
  body: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 0 },
})
