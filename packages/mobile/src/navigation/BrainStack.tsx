import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { BrainHomeScreen } from '../screens/brain/BrainHomeScreen'
import { BrainTrainingScreen } from '../screens/brain/BrainTrainingScreen'
import { BrainPlayScreen } from '../screens/brain/BrainPlayScreen'
import { BrainResearchScreen } from '../screens/brain/BrainResearchScreen'
import type { BrainStackParamList } from './types'

const Stack = createNativeStackNavigator<BrainStackParamList>()

/**
 * Brain training. The two play screens turn off the iOS back swipe: Quick Eye's direction buttons
 * sit near the screen edge, and a slip there would end Today's Training without counting it.
 * "Finish" (and Android's back button, which RoundView routes to it) is the way out, with a
 * confirmation once anything has been played.
 */
export function BrainStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="BrainHome" component={BrainHomeScreen} />
      <Stack.Screen name="BrainTraining" component={BrainTrainingScreen} options={{ gestureEnabled: false }} />
      <Stack.Screen name="BrainPlay" component={BrainPlayScreen} options={{ gestureEnabled: false }} />
      <Stack.Screen name="BrainResearch" component={BrainResearchScreen} />
    </Stack.Navigator>
  )
}
