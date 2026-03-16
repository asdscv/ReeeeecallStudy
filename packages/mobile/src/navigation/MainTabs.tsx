import { View, Text, StyleSheet } from 'react-native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { useTheme } from '../theme'
import type { MainTabParamList } from './types'

const Tab = createBottomTabNavigator<MainTabParamList>()

// Placeholder screens — will be replaced in Phase 3+
function PlaceholderScreen({ name }: { name: string }) {
  const theme = useTheme()
  return (
    <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
      <Text style={[theme.typography.h2, { color: theme.colors.text }]}>{name}</Text>
      <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, marginTop: 8 }]}>
        Coming in Phase 3
      </Text>
    </View>
  )
}

function HomeScreen() { return <PlaceholderScreen name="Home" /> }
function DecksScreen() { return <PlaceholderScreen name="Decks" /> }
function StudyScreen() { return <PlaceholderScreen name="Study" /> }
function MarketplaceScreen() { return <PlaceholderScreen name="Marketplace" /> }
function SettingsScreen() { return <PlaceholderScreen name="Settings" /> }

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
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarLabel: 'Home' }} />
      <Tab.Screen name="Decks" component={DecksScreen} options={{ tabBarLabel: 'Decks' }} />
      <Tab.Screen name="Study" component={StudyScreen} options={{ tabBarLabel: 'Study' }} />
      <Tab.Screen name="Marketplace" component={MarketplaceScreen} options={{ tabBarLabel: 'Market' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarLabel: 'Settings' }} />
    </Tab.Navigator>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
