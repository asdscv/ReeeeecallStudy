import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { StudySetupScreen } from '../screens/StudySetupScreen'
import { StudySessionScreen } from '../screens/StudySessionScreen'
import { StudySummaryScreen } from '../screens/StudySummaryScreen'
import type { StudyStackParamList } from './types'

const Stack = createNativeStackNavigator<StudyStackParamList>()

export function StudyStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: false, // Prevent back gesture during study
      }}
    >
      <Stack.Screen name="StudySetup" component={StudySetupScreen} />
      <Stack.Screen name="StudySession" component={StudySessionScreen} />
      <Stack.Screen name="StudySummary" component={StudySummaryScreen} />
    </Stack.Navigator>
  )
}
