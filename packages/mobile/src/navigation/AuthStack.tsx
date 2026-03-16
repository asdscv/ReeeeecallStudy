import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { LoginScreen } from '../screens/LoginScreen'
import { SignUpScreen } from '../screens/SignUpScreen'
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen'
import type { AuthStackParamList } from './types'

const Stack = createNativeStackNavigator<AuthStackParamList>()

export function AuthStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </Stack.Navigator>
  )
}
