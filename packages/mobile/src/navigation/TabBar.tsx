import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DrawerActions, type NavigationProp, type ParamListBase } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { useTheme, palette } from '../theme'
import { haptics } from '../utils/haptics'
import { tabFor, type NavLocation, type TabKey } from './nav-location'

type FeatherName = React.ComponentProps<typeof Feather>['name']

const TABS: { key: Exclude<TabKey, 'more'>; icon: FeatherName; stack: string; screen?: string }[] = [
  { key: 'home', icon: 'bar-chart-2', stack: 'HomeTab', screen: 'Dashboard' },
  { key: 'study', icon: 'zap', stack: 'StudyTab' },
  { key: 'decks', icon: 'book-open', stack: 'DecksTab', screen: 'DecksList' },
  { key: 'brain', icon: 'grid', stack: 'BrainTab', screen: 'BrainHome' },
]

/**
 * The four places people go most, one tap from anywhere, and "메뉴" for the rest (it opens the
 * drawer). Before this every destination went through the drawer, and decks, history and the
 * market sat behind a collapsed group AND a collapsed section — four taps from the dashboard.
 *
 * Rendered by the drawer's `screenLayout`, so it sits inside each screen and the drawer slides
 * over it like everything else.
 */
export function TabBar({ navigation, location }: { navigation: NavigationProp<ParamListBase>; location: NavLocation }) {
  const theme = useTheme()
  const { t } = useTranslation('common')
  const insets = useSafeAreaInsets()
  const current = tabFor(location)
  const activeColor = theme.isDark ? palette.blue[300] : palette.blue[700]
  const idleColor = theme.colors.textSecondary

  const item = (key: TabKey, icon: FeatherName, onPress: () => void) => {
    const active = current === key
    return (
      <Pressable
        key={key}
        onPress={() => {
          haptics.selection()
          onPress()
        }}
        style={styles.item}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={t(`nav.short.${key}`)}
        testID={`tab-${key}`}
      >
        <Feather name={icon} size={22} color={active ? activeColor : idleColor} />
        <Text
          style={[styles.label, { color: active ? activeColor : idleColor, fontWeight: active ? '700' : '500' }]}
          numberOfLines={1}
        >
          {t(`nav.short.${key}`)}
        </Text>
      </Pressable>
    )
  }

  return (
    <View
      style={[styles.bar, { backgroundColor: theme.colors.surfaceElevated, borderTopColor: theme.colors.border, paddingBottom: Math.max(insets.bottom, 6) }]}
      accessibilityRole="tablist"
      testID="tab-bar"
    >
      {TABS.map((tab) =>
        item(tab.key, tab.icon, () =>
          tab.screen ? navigation.navigate(tab.stack, { screen: tab.screen }) : navigation.navigate(tab.stack),
        ),
      )}
      {item('more', 'menu', () => navigation.dispatch(DrawerActions.openDrawer()))}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  // 56pt tall rows: comfortably over the 44pt/48dp minimums for a control used this often.
  item: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontSize: 12 },
})
