import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { DecksListScreen } from '../screens/DecksListScreen'
import { DeckDetailScreen } from '../screens/DeckDetailScreen'
import { DeckEditScreen } from '../screens/DeckEditScreen'
import { CardEditScreen } from '../screens/CardEditScreen'
import type { DecksStackParamList } from './types'

const Stack = createNativeStackNavigator<DecksStackParamList>()

export function DecksStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="DecksList" component={DecksListScreen} />
      <Stack.Screen name="DeckDetail" component={DeckDetailScreen} />
      <Stack.Screen name="DeckEdit" component={DeckEditScreen} />
      <Stack.Screen name="CardEdit" component={CardEditScreen} />
    </Stack.Navigator>
  )
}
