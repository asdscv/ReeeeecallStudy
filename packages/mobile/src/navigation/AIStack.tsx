import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { AIHubScreen } from '../screens/ai/AIHubScreen'
import { aiHubRouteIssues } from '../screens/ai/aiHubRoutes'
import { AIGenerateScreen } from '../screens/AIGenerateScreen'
import { LearningGoalsScreen } from '../screens/LearningGoalsScreen'
import { LearningTodayScreen } from '../screens/LearningTodayScreen'
import type { AIStackParamList } from './types'

const Stack = createNativeStackNavigator<AIStackParamList>()

// A drifted catalog routes to a screen that does not exist, and the only symptom is a menu row
// that does nothing. Surfacing it at startup costs a dev-only check.
if (__DEV__) {
  const issues = aiHubRouteIssues()
  if (issues.length > 0) console.warn('[AIStack] AI hub entries with no route:', issues.join(', '))
}

/**
 * AI 학습 — its own stack, not three screens borrowed from Settings.
 *
 * AIGenerate, LearningGoals and LearningToday used to live in `SettingsStack`, which made them
 * reachable only by way of 설정. That is where you go to change a preference, not to plan a week
 * of study or to have a deck written for you, so the three most valuable surfaces in the app sat
 * behind the least likely tap. Grouping them under one stack gives the drawer a single place to
 * point at and gives generation somewhere to land with a mode already chosen.
 */
export function AIStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="AIHub" component={AIHubScreen} />
      <Stack.Screen name="AIGenerate" component={AIGenerateScreen} />
      <Stack.Screen name="LearningGoals" component={LearningGoalsScreen} />
      <Stack.Screen name="LearningToday" component={LearningTodayScreen} />
    </Stack.Navigator>
  )
}
