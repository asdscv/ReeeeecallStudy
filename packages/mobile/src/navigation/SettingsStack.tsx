import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SettingsScreen } from '../screens/SettingsScreen'
import { AIGenerateScreen } from '../screens/AIGenerateScreen'
import type { SettingsStackParamList } from './types'

const Stack = createNativeStackNavigator<SettingsStackParamList>()

export function SettingsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="SettingsHome" component={SettingsScreen} />
      <Stack.Screen name="AIGenerate" component={AIGenerateScreen} />
    </Stack.Navigator>
  )
}
