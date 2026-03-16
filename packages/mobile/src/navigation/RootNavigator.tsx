import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { AuthStack } from './AuthStack'
import { MainTabs } from './MainTabs'
import { useAuthState } from '../hooks/useAuthState'
import type { RootStackParamList } from './types'

const Stack = createNativeStackNavigator<RootStackParamList>()

export function RootNavigator() {
  const { user, loading } = useAuthState()

  if (loading) {
    return null // App.tsx shows splash while loading
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      {user ? (
        <Stack.Screen name="Main" component={MainTabs} />
      ) : (
        <Stack.Screen name="Auth" component={AuthStack} />
      )}
    </Stack.Navigator>
  )
}
