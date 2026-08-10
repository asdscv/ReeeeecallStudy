import { useState, useEffect } from 'react'
import { View, Text, Image, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { createDrawerNavigator, type DrawerContentComponentProps } from '@react-navigation/drawer'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { aiHubEntries } from '@reeeeecall/shared/lib/ai/hub/catalog'
import { useTheme, palette } from '../theme'
import { useAuthState } from '../hooks'
import { useAiHubEventBridge } from '../hooks/useAiHubEventBridge'
import { getMobileSupabase } from '../adapters'

// Stacks
import { HomeStack } from './HomeStack'
import { DecksStack } from './DecksStack'
import { StudyStack } from './StudyStack'
import { AIStack } from './AIStack'
import { QuizStack } from './QuizStack'
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
 *    └ AI 학습 (sub-group, always expanded — see the comment at its call site)
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
          onPress={() => { setStudyGroupOpen(!studyGroupOpen); if (!studyGroupOpen) setActiveItem('StudyGroup') }}
          style={[styles.menuItem, studyGroupOpen && { backgroundColor: theme.isDark ? 'rgba(59,130,246,0.15)' : palette.blue[50] }]}
          activeOpacity={0.7}
          testID="drawer-study-group"
          accessibilityLabel="drawer-study-group"
        >
          <Text style={styles.menuIcon}>📚</Text>
          <Text style={[styles.menuLabel, { color: studyGroupOpen ? (theme.isDark ? palette.blue[400] : palette.blue[700]) : theme.colors.text, flex: 1 }]}>{t('nav.study')}</Text>
          <Text style={[styles.chevron, { color: theme.colors.textSecondary }]}>
            {studyGroupOpen ? '∧' : '∨'}
          </Text>
        </TouchableOpacity>

        {studyGroupOpen && (
          <View>
            {/* AI 학습 — header opens the hub, its three features sit one level deeper.
                Always expanded rather than a second collapse: the parent 학습 group already
                starts closed on every mount, and nesting another toggle would put the newest
                menu three taps from the drawer opening. */}
            <MenuItem icon="🤖" label={t('nav.aiHub')} indent active={isActive('AIHub')} theme={theme}
              onPress={() => go('AITab', 'AIHub')} testID="drawer-ai-hub" />
            {aiHubEntries().map((entry) => (
              <MenuItem key={entry.id} icon={entry.icon} label={t(entry.titleKey, { ns: 'ai-generate' })}
                indent indentLevel={2} active={isActive(entry.mobileScreen)} theme={theme}
                onPress={() => go(entry.mobileStack, entry.mobileScreen)} testID={`drawer-ai-${entry.id}`} />
            ))}
            <MenuItem icon="📚" label={t('nav.decks')} indent active={isActive('DecksTab')} theme={theme}
              onPress={() => go('DecksTab', undefined, 'DecksTab')} testID="drawer-decks" />
            <MenuItem icon="📋" label={t('nav.cards')} indent active={isActive('TemplatesList')} theme={theme}
              onPress={() => go('SettingsTab', 'TemplatesList')} testID="drawer-cards" />
            <MenuItem icon="🏪" label={t('nav.marketplace')} indent active={isActive('MarketplaceTab')} theme={theme}
              onPress={() => go('MarketplaceTab', undefined, 'MarketplaceTab')} testID="drawer-marketplace" />
            <MenuItem icon="📊" label={t('nav.publisherStats', { defaultValue: 'Publisher Stats' })} indent active={isActive('PublisherStats')} theme={theme}
              onPress={() => go('SettingsTab', 'PublisherStats')} testID="drawer-publisher-stats" />
            <MenuItem icon="🔗" label={t('shares.title', { ns: 'settings', defaultValue: 'My Shares' })} indent active={isActive('MyShares')} theme={theme}
              onPress={() => go('SettingsTab', 'MyShares')} testID="drawer-my-shares" />
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

function MenuItem({ icon, label, active, theme, onPress, indent, indentLevel = 1, testID }: {
  icon: string; label: string; active: boolean
  theme: ReturnType<typeof useTheme>; onPress: () => void
  indent?: boolean; indentLevel?: 1 | 2; testID?: string
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      testID={testID}
      accessibilityLabel={testID}
      style={[
        styles.menuItem,
        indent && (indentLevel === 2 ? styles.menuItemIndent2 : styles.menuItemIndent),
        active && { backgroundColor: theme.isDark ? 'rgba(59,130,246,0.15)' : palette.blue[50] },
      ]}
    >
      <Text style={styles.menuIcon}>{icon}</Text>
      <Text style={[
        styles.menuLabel,
        { color: active ? (theme.isDark ? palette.blue[400] : palette.blue[700]) : theme.colors.text },
        active && { fontWeight: '600' },
      ]}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}

// ── Quick Tips — extensible: just add items to TIPS array ──
// Navigation-oriented tips only; study-gesture hints belong in the study screen.
const TIPS = [
  { icon: '☰', textKey: 'drawerTips.hamburger' },
  { icon: '📊', textKey: 'drawerTips.dashboard' },
  { icon: '⚡', textKey: 'drawerTips.quickStudy' },
]

function QuickTips({ theme }: { theme: ReturnType<typeof useTheme> }) {
  const { t } = useTranslation('common')
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
        {t(tip.textKey)}
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
  // Mounted here rather than in RootNavigator because this is the narrowest component that wraps
  // every authenticated screen: the bus only carries AI 학습 events, all of which are behind auth,
  // and a subscription above the auth branch would outlive a sign-out.
  useAiHubEventBridge()

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
      <Drawer.Screen name="AITab" component={AIStack} />
      <Drawer.Screen name="QuizTab" component={QuizStack} />
      <Drawer.Screen name="MarketplaceTab" component={MarketplaceStack} />
      <Drawer.Screen name="SettingsTab" component={SettingsStack} />
    </Drawer.Navigator>
  )
}

const styles = StyleSheet.create({
  drawerContainer: { flex: 1 },
  drawerHeader: { flexDirection: 'row', alignItems: 'center', gap: 0, paddingHorizontal: 12, paddingVertical: 16, borderBottomWidth: 1 },
  logoIcon: { width: 44, height: 44 },
  logoText: { height: 44, width: 126 },
  drawerScroll: { flex: 1, paddingTop: 8 },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14, marginHorizontal: 8, borderRadius: 10,
  },
  menuItemIndent: { paddingLeft: 48, paddingVertical: 10 },
  menuItemIndent2: { paddingLeft: 68, paddingVertical: 10 },
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
