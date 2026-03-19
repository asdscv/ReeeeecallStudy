import { Text } from 'react-native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme'
import { HomeStack } from './HomeStack'
import { DecksStack } from './DecksStack'
import { StudyStack } from './StudyStack'
import { MarketplaceStack } from './MarketplaceStack'
import { SettingsStack } from './SettingsStack'
import type { MainTabParamList } from './types'

const Tab = createBottomTabNavigator<MainTabParamList>()

const TAB_ICONS: Record<keyof MainTabParamList, { active: string; inactive: string }> = {
  HomeTab: { active: '🏠', inactive: '🏠' },
  DecksTab: { active: '📚', inactive: '📚' },
  StudyTab: { active: '🧠', inactive: '🧠' },
  MarketplaceTab: { active: '🏪', inactive: '🏪' },
  SettingsTab: { active: '⚙️', inactive: '⚙️' },
}

function TabIcon({ name, focused }: { name: keyof MainTabParamList; focused: boolean }) {
  const icons = TAB_ICONS[name]
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{focused ? icons.active : icons.inactive}</Text>
}

export function MainTabs() {
  const theme = useTheme()
  const { t } = useTranslation('common')

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textTertiary,
        tabBarStyle: {
          backgroundColor: theme.colors.surfaceElevated,
          borderTopColor: theme.colors.border,
          paddingTop: 4,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.05,
          shadowRadius: 4,
          elevation: 5,
        },
        tabBarLabelStyle: { ...theme.typography.caption, marginTop: -2 },
      }}
    >
      <Tab.Screen name="HomeTab" component={HomeStack}
        options={{ tabBarLabel: t('nav.dashboard'), tabBarAccessibilityLabel: 'HomeTab', tabBarIcon: ({ focused }) => <TabIcon name="HomeTab" focused={focused} /> }} />
      <Tab.Screen name="DecksTab" component={DecksStack}
        options={{ tabBarLabel: t('nav.decks'), tabBarAccessibilityLabel: 'DecksTab', tabBarIcon: ({ focused }) => <TabIcon name="DecksTab" focused={focused} /> }} />
      <Tab.Screen name="StudyTab" component={StudyStack}
        options={{ tabBarLabel: t('nav.study'), tabBarAccessibilityLabel: 'StudyTab', tabBarIcon: ({ focused }) => <TabIcon name="StudyTab" focused={focused} /> }} />
      <Tab.Screen name="MarketplaceTab" component={MarketplaceStack}
        options={{ tabBarLabel: t('nav.marketplace'), tabBarAccessibilityLabel: 'MarketplaceTab', tabBarIcon: ({ focused }) => <TabIcon name="MarketplaceTab" focused={focused} /> }} />
      <Tab.Screen name="SettingsTab" component={SettingsStack}
        options={{ tabBarLabel: t('nav.settings'), tabBarAccessibilityLabel: 'SettingsTab', tabBarIcon: ({ focused }) => <TabIcon name="SettingsTab" focused={focused} /> }} />
    </Tab.Navigator>
  )
}
