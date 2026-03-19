import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SettingsScreen } from '../screens/SettingsScreen'
import { AIGenerateScreen } from '../screens/AIGenerateScreen'
import { PaywallScreen } from '../screens/PaywallScreen'
import { GuideScreen } from '../screens/GuideScreen'
import { TemplatesListScreen } from '../screens/TemplatesListScreen'
import { TemplateEditScreen } from '../screens/TemplateEditScreen'
import { MySharesScreen } from '../screens/MySharesScreen'
import { PublisherStatsScreen } from '../screens/PublisherStatsScreen'
import type { SettingsStackParamList } from './types'

const Stack = createNativeStackNavigator<SettingsStackParamList>()

export function SettingsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="SettingsHome" component={SettingsScreen} />
      <Stack.Screen name="AIGenerate" component={AIGenerateScreen} />
      <Stack.Screen name="Paywall" component={PaywallScreen} />
      <Stack.Screen name="Guide" component={GuideScreen} />
      <Stack.Screen name="TemplatesList" component={TemplatesListScreen} />
      <Stack.Screen name="TemplateEdit" component={TemplateEditScreen} />
      <Stack.Screen name="MyShares" component={MySharesScreen} />
      <Stack.Screen name="PublisherStats" component={PublisherStatsScreen} />
    </Stack.Navigator>
  )
}
