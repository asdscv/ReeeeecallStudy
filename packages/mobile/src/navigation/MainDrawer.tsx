import { useState, useEffect } from 'react'
import { View, Text, Image, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { createDrawerNavigator, type DrawerContentComponentProps } from '@react-navigation/drawer'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useTheme, palette } from '../theme'
import { useAuthState } from '../hooks'
import { getMobileSupabase } from '../adapters'

// Stacks
import { HomeStack } from './HomeStack'
import { DecksStack } from './DecksStack'
import { StudyStack } from './StudyStack'
import { MarketplaceStack } from './MarketplaceStack'
import { SettingsStack } from './SettingsStack'
import type { MainTabParamList } from './types'

const Drawer = createDrawerNavigator<MainTabParamList>()

/**
 * Custom Drawer Content -- minimal, clean design.
 *
 * Menu structure:
 * 1. Quick Study
 * 2. Dashboard
 * 3. Study (group)
 * 4. Settings
 * 5. Admin (conditional)
 * ---
 * 6. Guide
 * ---
 * 7. Logout (subtle text link at bottom)
 */
function DrawerContent({ navigation, state }: DrawerContentComponentProps) {
  const theme = useTheme()
  const { t, i18n } = useTranslation('common')
  const { user } = useAuthState()
  const [studyGroupOpen, setStudyGroupOpen] = useState(false)
  const [role, setRole] = useState<string>('user')
  // Track which drawer item is active (not just the tab)
  const [activeItem, setActiveItem] = useState<string>('Dashboard')

  const activeRoute = state.routeNames[state.index]

  // Load user role
  useEffect(() => {
    if (!user) return
    const supabase = getMobileSupabase()
    supabase.from('profiles').select('role').eq('id', user.id).single()
      .then(({ data }) => {
        if (data?.role) setRole(data.role)
      })
  }, [user])

  const isActive = (item: string) => activeItem === item

  const go = (name: keyof MainTabParamList, screen?: string, item?: string) => {
    if (screen) {
      navigation.navigate(name, { screen } as any)
    } else {
      navigation.navigate(name)
    }
    setActiveItem(item ?? screen ?? name)
    navigation.closeDrawer()
  }

  return (
    <SafeAreaView style={[styles.drawerContainer, { backgroundColor: theme.colors.surfaceElevated }]}>
      {/* Logo — matches web: icon + text image */}
      <View style={[styles.drawerHeader, { borderBottomColor: theme.colors.border }]}>
        <Image source={require('../../assets/logo-icon.png')} style={styles.logoIcon} resizeMode="contain" />
        <Image source={require('../../assets/logo-text.png')} style={styles.logoText} resizeMode="contain" />
      </View>

      <ScrollView style={styles.drawerScroll} showsVerticalScrollIndicator={false}>
        {/* Quick Study */}
        <MenuItem
          icon="⚡" label={t('nav.quickStudy')}
          active={isActive('QuickStudy')}
          theme={theme}
          onPress={() => go('StudyTab', undefined, 'QuickStudy')}
          testID="drawer-quick-study"
        />

        {/* Dashboard */}
        <MenuItem
          icon="📊" label={t('nav.dashboard')}
          active={isActive('Dashboard')}
          theme={theme}
          onPress={() => go('HomeTab', 'Dashboard')}
          testID="drawer-dashboard"
        />

        {/* Study (group) */}
        <TouchableOpacity
          onPress={() => setStudyGroupOpen(!studyGroupOpen)}
          style={[styles.menuItem, studyGroupOpen && { backgroundColor: palette.blue[50] }]}
          activeOpacity={0.7}
          testID="drawer-study-group"
          accessibilityLabel="drawer-study-group"
        >
          <Text style={styles.menuIcon}>📚</Text>
          <Text style={[styles.menuLabel, { color: theme.colors.text, flex: 1 }]}>{t('nav.study')}</Text>
          <Text style={[styles.chevron, { color: theme.colors.textSecondary }]}>
            {studyGroupOpen ? '∧' : '∨'}
          </Text>
        </TouchableOpacity>

        {studyGroupOpen && (
          <View>
            <MenuItem icon="🤖" label={t('nav.aiGenerate')} indent active={isActive('AIGenerate')} theme={theme}
              onPress={() => go('SettingsTab', 'AIGenerate')} testID="drawer-ai-generate" />
            <MenuItem icon="📚" label={t('nav.decks')} indent active={isActive('DecksTab')} theme={theme}
              onPress={() => go('DecksTab', undefined, 'DecksTab')} testID="drawer-decks" />
            <MenuItem icon="📋" label={t('nav.cards')} indent active={isActive('TemplatesList')} theme={theme}
              onPress={() => go('SettingsTab', 'TemplatesList')} testID="drawer-cards" />
            <MenuItem icon="🏪" label={t('nav.marketplace')} indent active={isActive('MarketplaceTab')} theme={theme}
              onPress={() => go('MarketplaceTab', undefined, 'MarketplaceTab')} testID="drawer-marketplace" />
            <MenuItem icon="📊" label={t('nav.publisherStats', { defaultValue: 'Publisher Stats' })} indent active={isActive('PublisherStats')} theme={theme}
              onPress={() => go('SettingsTab', 'PublisherStats')} testID="drawer-publisher-stats" />
            <MenuItem icon="📝" label={t('nav.studyHistory')} indent active={isActive('StudyHistory')} theme={theme}
              onPress={() => go('HomeTab', 'StudyHistory')} testID="drawer-history" />
          </View>
        )}

        {/* Achievements */}
        <MenuItem
          icon="🏆" label={t('nav.achievements', { defaultValue: 'Achievements' })}
          active={isActive('Achievements')}
          theme={theme}
          onPress={() => go('SettingsTab', 'Achievements')}
          testID="drawer-achievements"
        />

        {/* Settings */}
        <MenuItem
          icon="⚙️" label={t('nav.settings')}
          active={isActive('SettingsHome')}
          theme={theme}
          onPress={() => go('SettingsTab', 'SettingsHome')}
          testID="drawer-settings"
        />

        {/* Admin (conditional) */}
        {role === 'admin' && (
          <MenuItem
            icon="🛡️" label={t('nav.admin')}
            active={isActive('Admin')}
            theme={theme}
            onPress={() => { setActiveItem('Admin'); navigation.closeDrawer() }}
          />
        )}

        {/* Divider */}
        <View style={[styles.divider, { borderTopColor: theme.colors.border }]} />

        {/* Guide */}
        <MenuItem
          icon="📖" label={t('nav.guide')}
          active={isActive('Guide')}
          theme={theme}
          onPress={() => go('SettingsTab', 'Guide')}
          testID="drawer-guide"
        />
      </ScrollView>

      {/* Quick Tips — always visible at bottom */}
      <QuickTips theme={theme} />
    </SafeAreaView>
  )
}

function MenuItem({ icon, label, active, theme, onPress, indent, testID }: {
  icon: string; label: string; active: boolean
  theme: ReturnType<typeof useTheme>; onPress: () => void; indent?: boolean; testID?: string
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      testID={testID}
      accessibilityLabel={testID}
      style={[
        styles.menuItem,
        indent && styles.menuItemIndent,
        active && { backgroundColor: palette.blue[50] },
      ]}
    >
      <Text style={styles.menuIcon}>{icon}</Text>
      <Text style={[
        styles.menuLabel,
        { color: active ? palette.blue[700] : theme.colors.text },
        active && { fontWeight: '600' },
      ]}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}

// ── Quick Tips — extensible: just add items to TIPS array ──
const TIPS = [
  { icon: '👆', text: 'Tap card to flip, swipe left/right to rate' },
  { icon: '☰', text: 'Tap hamburger menu (☰) to navigate' },
  { icon: '📊', text: 'Dashboard shows your study stats & streaks' },
  { icon: '⚡', text: 'Quick Study starts a session instantly' },
]

function QuickTips({ theme }: { theme: ReturnType<typeof useTheme> }) {
  const [tipIndex, setTipIndex] = useState(0)
  const tip = TIPS[tipIndex]

  return (
    <TouchableOpacity
      onPress={() => setTipIndex((i) => (i + 1) % TIPS.length)}
      activeOpacity={0.7}
      style={[styles.tipContainer, { borderTopColor: theme.colors.border }]}
    >
      <Text style={styles.tipIcon}>{tip.icon}</Text>
      <Text style={[styles.tipText, { color: theme.colors.textSecondary }]} numberOfLines={2}>
        {tip.text}
      </Text>
      <Text style={[styles.tipCounter, { color: theme.colors.textTertiary }]}>
        {tipIndex + 1}/{TIPS.length}
      </Text>
    </TouchableOpacity>
  )
}

// Drawer Navigator
export function MainDrawer() {
  const theme = useTheme()

  return (
    <Drawer.Navigator
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        drawerStyle: {
          width: 280,
          backgroundColor: theme.colors.surfaceElevated,
        },
        swipeEnabled: true,
        swipeEdgeWidth: 40,
      }}
    >
      <Drawer.Screen name="HomeTab" component={HomeStack} />
      <Drawer.Screen name="DecksTab" component={DecksStack} />
      <Drawer.Screen name="StudyTab" component={StudyStack} />
      <Drawer.Screen name="MarketplaceTab" component={MarketplaceStack} />
      <Drawer.Screen name="SettingsTab" component={SettingsStack} />
    </Drawer.Navigator>
  )
}

const styles = StyleSheet.create({
  drawerContainer: { flex: 1 },
  drawerHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  logoIcon: { width: 36, height: 36 },
  logoText: { height: 28, width: 140 },
  drawerScroll: { flex: 1, paddingTop: 8 },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14, marginHorizontal: 8, borderRadius: 10,
  },
  menuItemIndent: { paddingLeft: 48, paddingVertical: 10 },
  menuIcon: { fontSize: 18 },
  menuLabel: { fontSize: 15 },
  chevron: { fontSize: 18, fontWeight: '300' },
  divider: { borderTopWidth: 1, marginVertical: 8, marginHorizontal: 16 },
  tipContainer: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1,
  },
  tipIcon: { fontSize: 16 },
  tipText: { flex: 1, fontSize: 12, lineHeight: 16 },
  tipCounter: { fontSize: 10 },
})
