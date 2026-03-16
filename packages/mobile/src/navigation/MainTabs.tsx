import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { useTheme } from '../theme'
import { DashboardScreen } from '../screens/DashboardScreen'
import { DecksStack } from './DecksStack'
import { StudyStack } from './StudyStack'
import { MarketplaceStack } from './MarketplaceStack'
import { SettingsStack } from './SettingsStack'
import type { MainTabParamList } from './types'

const Tab = createBottomTabNavigator<MainTabParamList>()

export function MainTabs() {
  const theme = useTheme()

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textTertiary,
        tabBarStyle: {
          backgroundColor: theme.colors.surfaceElevated,
          borderTopColor: theme.colors.border,
        },
        tabBarLabelStyle: { ...theme.typography.caption },
      }}
    >
      <Tab.Screen name="HomeTab" component={DashboardScreen} options={{ tabBarLabel: 'Home' }} />
      <Tab.Screen name="DecksTab" component={DecksStack} options={{ tabBarLabel: 'Decks' }} />
      <Tab.Screen name="StudyTab" component={StudyStack} options={{ tabBarLabel: 'Study' }} />
      <Tab.Screen name="MarketplaceTab" component={MarketplaceStack} options={{ tabBarLabel: 'Market' }} />
      <Tab.Screen name="SettingsTab" component={SettingsStack} options={{ tabBarLabel: 'Settings' }} />
    </Tab.Navigator>
  )
}
