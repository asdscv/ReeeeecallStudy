import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { BrainHomeScreen } from '../screens/brain/BrainHomeScreen'
import { BrainPlayScreen } from '../screens/brain/BrainPlayScreen'
import type { BrainStackParamList } from './types'

const Stack = createNativeStackNavigator<BrainStackParamList>()

/**
 * Brain training. The play screen keeps the back gesture: every round is saved the moment it
 * is judged, so leaving mid-run loses nothing — unlike a study session, there is no exit to guard.
 */
export function BrainStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="BrainHome" component={BrainHomeScreen} />
      <Stack.Screen name="BrainPlay" component={BrainPlayScreen} />
    </Stack.Navigator>
  )
}
