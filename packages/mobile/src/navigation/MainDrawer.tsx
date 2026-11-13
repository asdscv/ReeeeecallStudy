import { useState, useEffect } from 'react'
import { Feather } from '@expo/vector-icons'

/**
 * 드로어 아이콘은 이모지였다(⚡📊📚🤖…). 이모지는 플랫폼·폰트마다 다르게 그려지고
 * 색을 못 따라가서 활성/비활성 상태를 표현하지 못한다 — 메뉴가 열려 있는데 아이콘만
 * 회색이 아닌 원색으로 남는 식이다. Feather 는 이미 StudySessionScreen 이 쓰고 있어
 * 새 의존성이 아니고, size/color 를 테마에서 받는다.
 */
type FeatherName = React.ComponentProps<typeof Feather>['name']
import { View, Text, Image, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { createDrawerNavigator, type DrawerContentComponentProps } from '@react-navigation/drawer'
import { getFocusedRouteNameFromRoute, useNavigationState, type NavigationProp, type ParamListBase } from '@react-navigation/native'
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
import { BrainStack } from './BrainStack'
import { MarketplaceStack } from './MarketplaceStack'
import { SettingsStack } from './SettingsStack'
import type { MainTabParamList } from './types'
import { TabBar } from './TabBar'
import { navLocation, isDrawerItemActive, isFullscreenScreen, showsTabBar } from './nav-location'
import { TabBarVisibleContext } from '../components/ui/tab-bar-context'

const Drawer = createDrawerNavigator<MainTabParamList>()

/**
 * The full menu.
 *
 * Every section is open. They used to collapse twice over — a 학습 group holding four sections
 * that each folded — which put decks, history and the market four taps from the dashboard and
 * made the drawer a puzzle to reopen. The drawer is the whole screen on a phone and it scrolls;
 * fifteen visible rows cost less than two extra taps to every one of them. The four most used
 * places are also on the tab bar, so the drawer is the map, not the road.
 */
function DrawerContent({ navigation, state }: DrawerContentComponentProps) {
  const theme = useTheme()
  const { t } = useTranslation('common')
  const { user } = useAuthState()
  const [role, setRole] = useState<string>('user')
  const location = navLocation(state)

  // Load user role
  useEffect(() => {
    if (!user) return
    const supabase = getMobileSupabase()
    supabase.from('profiles').select('role').eq('id', user.id).single()
      .then(({ data }) => {
        if (data?.role) setRole(data.role)
      })
  }, [user])

  const isActive = (item: string) => isDrawerItemActive(item, location)

  const go = (name: keyof MainTabParamList, screen?: string) => {
    if (screen) {
      navigation.navigate(name, { screen } as any)
    } else {
      navigation.navigate(name)
    }
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
        <MenuItem icon="zap" label={t('nav.quickStudy')} active={isActive('QuickStudy')} theme={theme}
          onPress={() => go('StudyTab')} testID="drawer-quick-study" />
        <MenuItem icon="bar-chart-2" label={t('nav.dashboard')} active={isActive('Dashboard')} theme={theme}
          onPress={() => go('HomeTab', 'Dashboard')} testID="drawer-dashboard" />
        {/* Its own row, not a 학습 section: it studies no deck. */}
        <MenuItem icon="grid" label={t('nav.brainTraining')} active={isActive('BrainHome')} theme={theme}
          onPress={() => go('BrainTab', 'BrainHome')} testID="drawer-brain" />

        <SectionLabel label={t('nav.study')} theme={theme} />
        {/* `nav.cards` pointed at TemplatesList, whose own screen is titled 카드 템플릿 — there is no
            card list on mobile either; cards live inside a deck. */}
        <MenuItem icon="book-open" label={t('nav.decks')} active={isActive('DecksTab')} theme={theme}
          onPress={() => go('DecksTab')} testID="drawer-decks" />
        <MenuItem icon="file-text" label={t('nav.cardTemplates')} active={isActive('TemplatesList')} theme={theme}
          onPress={() => go('SettingsTab', 'TemplatesList')} testID="drawer-cards" />

        {/* AI 학습 — the hub, then its features, derived from the catalog so a new one appears here
            without an edit. */}
        <SectionLabel label={t('nav.aiHub')} theme={theme} />
        <MenuItem icon="layers" label={t('nav.aiHubHome')} active={isActive('AIHub')} theme={theme}
          onPress={() => go('AITab', 'AIHub')} testID="drawer-ai-hub" />
        {aiHubEntries().map((entry) => (
          <MenuItem key={entry.id} icon={entry.icon as FeatherName} label={t(entry.titleKey, { ns: 'ai-generate' })}
            active={isActive(entry.mobileScreen)} theme={theme}
            onPress={() => go(entry.mobileStack, entry.mobileScreen)} testID={`drawer-ai-${entry.id}`} />
        ))}

        <SectionLabel label={t('nav.explore')} theme={theme} />
        <MenuItem icon="shopping-bag" label={t('nav.marketplace')} active={isActive('MarketplaceTab')} theme={theme}
          onPress={() => go('MarketplaceTab')} testID="drawer-marketplace" />
        <MenuItem icon="bar-chart-2" label={t('nav.publisherStats', { defaultValue: 'Publisher Stats' })} active={isActive('PublisherStats')} theme={theme}
          onPress={() => go('SettingsTab', 'PublisherStats')} testID="drawer-publisher-stats" />
        <MenuItem icon="link-2" label={t('nav.myShares')} active={isActive('MyShares')} theme={theme}
          onPress={() => go('SettingsTab', 'MyShares')} testID="drawer-my-shares" />

        <SectionLabel label={t('nav.myRecords')} theme={theme} />
        <MenuItem icon="clock" label={t('nav.studyHistory')} active={isActive('StudyHistory')} theme={theme}
          onPress={() => go('HomeTab', 'StudyHistory')} testID="drawer-history" />
        <MenuItem icon="award" label={t('nav.achievements', { defaultValue: 'Achievements' })} active={isActive('Achievements')} theme={theme}
          onPress={() => go('SettingsTab', 'Achievements')} testID="drawer-achievements" />

        <View style={[styles.divider, { borderTopColor: theme.colors.border }]} />

        <MenuItem icon="settings" label={t('nav.settings')} active={isActive('SettingsHome')} theme={theme}
          onPress={() => go('SettingsTab', 'SettingsHome')} testID="drawer-settings" />
        <MenuItem icon="help-circle" label={t('nav.guide')} active={isActive('Guide')} theme={theme}
          onPress={() => go('SettingsTab', 'Guide')} testID="drawer-guide" />
        {role === 'admin' && (
          <MenuItem icon="shield" label={t('nav.admin')} active={false} theme={theme}
            onPress={() => navigation.closeDrawer()} />
        )}
      </ScrollView>

      {/* Quick Tips — always visible at bottom */}
      <QuickTips theme={theme} />
    </SafeAreaView>
  )
}

/** A section heading. Plain text: every section is open, so there is nothing to toggle. */
function SectionLabel({ label, theme }: { label: string; theme: ReturnType<typeof useTheme> }) {
  return (
    <Text style={[styles.sectionText, { color: theme.colors.textSecondary }]} accessibilityRole="header">
      {label}
    </Text>
  )
}

function MenuItem({ icon, label, active, theme, onPress, testID }: {
  icon: FeatherName; label: string; active: boolean
  theme: ReturnType<typeof useTheme>; onPress: () => void; testID?: string
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      testID={testID}
      accessibilityLabel={testID}
      style={[
        styles.menuItem,
        active && { backgroundColor: theme.isDark ? 'rgba(59,130,246,0.15)' : palette.blue[50] },
      ]}
    >
      <Feather
        name={icon}
        size={18}
        color={active ? (theme.isDark ? palette.blue[300] : palette.blue[700]) : theme.colors.textSecondary}
        style={styles.menuIcon}
      />
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
  { icon: 'menu', textKey: 'drawerTips.hamburger' },
  { icon: 'bar-chart-2', textKey: 'drawerTips.dashboard' },
  { icon: 'zap', textKey: 'drawerTips.quickStudy' },
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
      <Feather
        name={tip.icon as FeatherName}
        size={15}
        color={theme.colors.textTertiary}
        style={styles.tipIcon}
      />
      <Text style={[styles.tipText, { color: theme.colors.textSecondary }]} numberOfLines={2}>
        {t(tip.textKey)}
      </Text>
      <Text style={[styles.tipCounter, { color: theme.colors.textTertiary }]}>
        {tipIndex + 1}/{TIPS.length}
      </Text>
    </TouchableOpacity>
  )
}

function TabbedScreen({ children, navigation }: { children: React.ReactNode; navigation: NavigationProp<ParamListBase> }) {
  // The drawer's state, so the bar knows which stack and screen are focused.
  const drawerState = useNavigationState((s) => s)
  const location = navLocation(drawerState as Parameters<typeof navLocation>[0])
  const visible = showsTabBar(location)
  return (
    <View style={styles.tabbed}>
      <TabBarVisibleContext.Provider value={visible}>
        <View style={styles.tabbed}>{children}</View>
      </TabBarVisibleContext.Provider>
      {visible && <TabBar navigation={navigation} location={location} />}
    </View>
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
      // The tab bar lives inside each screen so the drawer slides over it like everything else.
      screenLayout={({ children, navigation }) => <TabbedScreen navigation={navigation}>{children}</TabbedScreen>}
      screenOptions={({ route }) => ({
        headerShown: false,
        drawerType: 'front',
        drawerStyle: {
          width: 280,
          backgroundColor: theme.colors.surfaceElevated,
        },
        // Off on full-screen surfaces: the 40pt edge zone sat on top of the first column of game
        // grids.
        swipeEnabled: !isFullscreenScreen(getFocusedRouteNameFromRoute(route)),
        swipeEdgeWidth: 40,
      })}
    >
      <Drawer.Screen name="HomeTab" component={HomeStack} />
      <Drawer.Screen name="DecksTab" component={DecksStack} />
      <Drawer.Screen name="StudyTab" component={StudyStack} />
      <Drawer.Screen name="AITab" component={AIStack} />
      <Drawer.Screen name="QuizTab" component={QuizStack} />
      <Drawer.Screen name="BrainTab" component={BrainStack} />
      <Drawer.Screen name="MarketplaceTab" component={MarketplaceStack} />
      <Drawer.Screen name="SettingsTab" component={SettingsStack} />
    </Drawer.Navigator>
  )
}

const styles = StyleSheet.create({
  tabbed: { flex: 1 },
  drawerContainer: { flex: 1 },
  drawerHeader: { flexDirection: 'row', alignItems: 'center', gap: 0, paddingHorizontal: 12, paddingVertical: 16, borderBottomWidth: 1 },
  logoIcon: { width: 44, height: 44 },
  logoText: { height: 44, width: 126 },
  drawerScroll: { flex: 1, paddingTop: 8 },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, minHeight: 48, marginHorizontal: 8, borderRadius: 10,
  },
  sectionText: { fontSize: 13, fontWeight: '700', paddingHorizontal: 24, paddingTop: 18, paddingBottom: 6 },
  menuIcon: { width: 22, textAlign: 'center' },
  menuLabel: { fontSize: 15 },
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
