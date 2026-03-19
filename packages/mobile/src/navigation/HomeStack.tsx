import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { DashboardScreen } from '../screens/DashboardScreen'
import { StudyHistoryScreen } from '../screens/StudyHistoryScreen'
import { SessionDetailScreen } from '../screens/SessionDetailScreen'
import type { HomeStackParamList } from './types'

const Stack = createNativeStackNavigator<HomeStackParamList>()

export function HomeStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
      <Stack.Screen name="StudyHistory" component={StudyHistoryScreen} />
      <Stack.Screen name="SessionDetail" component={SessionDetailScreen} />
    </Stack.Navigator>
  )
}
