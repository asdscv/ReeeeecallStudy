import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { QuizHomeScreen } from '../screens/quiz/QuizHomeScreen'
import { QuizSetupScreen } from '../screens/quiz/QuizSetupScreen'
import { QuizSetDetailScreen } from '../screens/quiz/QuizSetDetailScreen'
import { QuizMistakesScreen } from '../screens/quiz/QuizMistakesScreen'
import { QuizRunScreen } from '../screens/quiz/QuizRunScreen'
import { QuizResultScreen } from '../screens/quiz/QuizResultScreen'
import type { QuizStackParamList } from './types'

const Stack = createNativeStackNavigator<QuizStackParamList>()

/**
 * Quiz is its own stack, not a screen inside the study stack.
 *
 * Card study is six ways of ordering one interaction — show, flip, self-rate. Quiz is a
 * different act: the learner produces an answer and something else judges it. Mixing them
 * would put a paid, answer-typing flow behind a menu labelled "study modes", where the only
 * thing it shares with its neighbours is that both involve cards.
 */
export function QuizStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="QuizHome" component={QuizHomeScreen} />
      <Stack.Screen name="QuizSetup" component={QuizSetupScreen} />
      <Stack.Screen name="QuizSetDetail" component={QuizSetDetailScreen} />
      <Stack.Screen name="QuizMistakes" component={QuizMistakesScreen} />
      {/* Taking the quiz disables the back gesture for the same reason the study session
          does: a swipe mid-question is almost always the phone, not the learner. */}
      <Stack.Screen name="QuizRun" component={QuizRunScreen} options={{ gestureEnabled: false }} />
      <Stack.Screen name="QuizResult" component={QuizResultScreen} />
    </Stack.Navigator>
  )
}
