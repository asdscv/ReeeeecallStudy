import { View, Text, StyleSheet } from 'react-native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { useTheme } from '../theme'
import { DashboardScreen } from '../screens/DashboardScreen'
import { DecksStack } from './DecksStack'
import { StudyStack } from './StudyStack'
import type { MainTabParamList } from './types'

const Tab = createBottomTabNavigator<MainTabParamList>()

// Placeholder screens — Phase 4, 5
function PlaceholderScreen({ name }: { name: string }) {
  const theme = useTheme()
  return (
    <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
      <Text style={[theme.typography.h2, { color: theme.colors.text }]}>{name}</Text>
      <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, marginTop: 8 }]}>
        Coming soon
      </Text>
    </View>
  )
}

function MarketplaceTab() { return <PlaceholderScreen name="Marketplace" /> }
function SettingsTab() { return <PlaceholderScreen name="Settings" /> }

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
      <Tab.Screen name="MarketplaceTab" component={MarketplaceTab} options={{ tabBarLabel: 'Market' }} />
      <Tab.Screen name="SettingsTab" component={SettingsTab} options={{ tabBarLabel: 'Settings' }} />
    </Tab.Navigator>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
