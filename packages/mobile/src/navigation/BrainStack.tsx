import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { BrainHomeScreen } from '../screens/brain/BrainHomeScreen'
import { BrainTrainingScreen } from '../screens/brain/BrainTrainingScreen'
import { BrainPlayScreen } from '../screens/brain/BrainPlayScreen'
import type { BrainStackParamList } from './types'

const Stack = createNativeStackNavigator<BrainStackParamList>()

/**
 * Brain training. The two play screens turn off the iOS back swipe: a board's edge cells sit near
 * the screen edge, and a slip there would end Today's Training without counting it.
 * "Finish" (and Android's back button, which RoundView routes to it) is the way out, with a
 * confirmation once anything has been played.
 *
 * The home screen freezes while a game is on top of it: it reads the same store every judged trial
 * writes to, and re-rendering its nine game cards behind a running round is work the round's
 * frames should not wait for.
 */
export function BrainStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="BrainHome" component={BrainHomeScreen} options={{ freezeOnBlur: true }} />
      <Stack.Screen name="BrainTraining" component={BrainTrainingScreen} options={{ gestureEnabled: false }} />
      <Stack.Screen name="BrainPlay" component={BrainPlayScreen} options={{ gestureEnabled: false }} />
    </Stack.Navigator>
  )
}
