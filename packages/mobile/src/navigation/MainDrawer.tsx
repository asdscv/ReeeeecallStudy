import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native'
import { createDrawerNavigator, type DrawerContentComponentProps } from '@react-navigation/drawer'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { useTheme, palette } from '../theme'
import { useAuth, useAuthState } from '../hooks'
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
  const { signOut } = useAuth()
  const { user } = useAuthState()
  const [studyGroupOpen, setStudyGroupOpen] = useState(false)
  const [role, setRole] = useState<string>('user')

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

  const isActive = (name: string) => activeRoute === name

  const go = (name: keyof MainTabParamList, screen?: string) => {
    if (screen) {
      navigation.navigate(name, { screen } as any)
    } else {
      navigation.navigate(name)
    }
    navigation.closeDrawer()
  }

  const handleLogout = () => {
    navigation.closeDrawer()
    Alert.alert(t('actions.logout'), t('account.logoutConfirm', { ns: 'settings', defaultValue: 'Are you sure you want to sign out?' }), [
      { text: t('actions.cancel'), style: 'cancel' },
      { text: t('actions.logout'), style: 'destructive', onPress: signOut },
    ])
  }

  return (
    <SafeAreaView style={[styles.drawerContainer, { backgroundColor: theme.colors.surfaceElevated }]}>
      {/* Logo */}
      <View style={[styles.drawerHeader, { borderBottomColor: theme.colors.border }]}>
        <Text style={[styles.brandText, { color: theme.colors.text }]}>ReeeeecallStudy</Text>
      </View>

      <ScrollView style={styles.drawerScroll} showsVerticalScrollIndicator={false}>
        {/* Quick Study */}
        <MenuItem
          icon="⚡" label={t('nav.quickStudy')}
          active={isActive('StudyTab')}
          theme={theme}
          onPress={() => go('StudyTab')}
        />

        {/* Dashboard */}
        <MenuItem
          icon="📊" label={t('nav.dashboard')}
          active={isActive('HomeTab')}
          theme={theme}
          onPress={() => go('HomeTab', 'Dashboard')}
        />

        {/* Study (group) */}
        <TouchableOpacity
          onPress={() => setStudyGroupOpen(!studyGroupOpen)}
          style={[styles.menuItem, studyGroupOpen && { backgroundColor: palette.blue[50] }]}
          activeOpacity={0.7}
        >
          <Text style={styles.menuIcon}>📚</Text>
          <Text style={[styles.menuLabel, { color: theme.colors.text, flex: 1 }]}>{t('nav.study')}</Text>
          <Text style={[styles.chevron, { color: theme.colors.textTertiary }]}>
            {studyGroupOpen ? '▾' : '▸'}
          </Text>
        </TouchableOpacity>

        {studyGroupOpen && (
          <View>
            <MenuItem icon="🤖" label={t('nav.aiGenerate')} indent active={false} theme={theme}
              onPress={() => go('SettingsTab', 'AIGenerate')} />
            <MenuItem icon="📚" label={t('nav.decks')} indent active={isActive('DecksTab')} theme={theme}
              onPress={() => go('DecksTab')} />
            <MenuItem icon="📋" label={t('nav.cards')} indent active={false} theme={theme}
              onPress={() => go('SettingsTab', 'TemplatesList')} />
            <MenuItem icon="🏪" label={t('nav.marketplace')} indent active={isActive('MarketplaceTab')} theme={theme}
              onPress={() => go('MarketplaceTab')} />
            <MenuItem icon="📝" label={t('nav.studyHistory')} indent active={false} theme={theme}
              onPress={() => go('HomeTab', 'StudyHistory')} />
          </View>
        )}

        {/* My Shares */}
        <MenuItem
          icon="📤" label={t('nav.marketplace', { defaultValue: 'My Shares' })}
          active={false}
          theme={theme}
          onPress={() => go('SettingsTab', 'MyShares')}
        />

        {/* Settings */}
        <MenuItem
          icon="⚙️" label={t('nav.settings')}
          active={isActive('SettingsTab')}
          theme={theme}
          onPress={() => go('SettingsTab', 'SettingsHome')}
        />

        {/* Admin (conditional) */}
        {role === 'admin' && (
          <MenuItem
            icon="🛡️" label={t('nav.admin')}
            active={false}
            theme={theme}
            onPress={() => navigation.closeDrawer()}
          />
        )}

        {/* Divider */}
        <View style={[styles.divider, { borderTopColor: theme.colors.border }]} />

        {/* Guide */}
        <MenuItem
          icon="📖" label={t('nav.guide')}
          active={false}
          theme={theme}
          onPress={() => go('SettingsTab', 'Guide')}
        />
      </ScrollView>

      {/* Logout at the very bottom, subtle text link */}
      <View style={[styles.drawerFooter, { borderTopColor: theme.colors.border }]}>
        <TouchableOpacity onPress={handleLogout} activeOpacity={0.7} style={styles.logoutLink}>
          <Text style={[styles.logoutText, { color: palette.gray[400] }]}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

function MenuItem({ icon, label, active, theme, onPress, indent }: {
  icon: string; label: string; active: boolean
  theme: ReturnType<typeof useTheme>; onPress: () => void; indent?: boolean
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
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
  drawerHeader: { paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  brandText: { fontSize: 18, fontWeight: '700' },
  drawerScroll: { flex: 1, paddingTop: 8 },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14, marginHorizontal: 8, borderRadius: 10,
  },
  menuItemIndent: { paddingLeft: 48, paddingVertical: 10 },
  menuIcon: { fontSize: 18 },
  menuLabel: { fontSize: 15 },
  chevron: { fontSize: 14 },
  divider: { borderTopWidth: 1, marginVertical: 8, marginHorizontal: 16 },
  // Footer with subtle logout
  drawerFooter: {
    borderTopWidth: 1, paddingHorizontal: 20, paddingVertical: 16,
  },
  logoutLink: { paddingVertical: 4 },
  logoutText: { fontSize: 14 },
})
