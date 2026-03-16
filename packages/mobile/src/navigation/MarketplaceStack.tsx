import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { MarketplaceScreen } from '../screens/MarketplaceScreen'
import { MarketplaceDetailScreen } from '../screens/MarketplaceDetailScreen'
import type { MarketplaceStackParamList } from './types'

const Stack = createNativeStackNavigator<MarketplaceStackParamList>()

export function MarketplaceStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="MarketplaceHome" component={MarketplaceScreen} />
      <Stack.Screen name="MarketplaceDetail" component={MarketplaceDetailScreen} />
    </Stack.Navigator>
  )
}
