import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SettingsScreen } from '../screens/SettingsScreen'
import { AIGenerateScreen } from '../screens/AIGenerateScreen'
// ─────────────────────────────────────────────────────────────────────────
// [SUBSCRIPTION-HIDDEN] 구독 기능 심사 보류 — 2026-04-15
// Apple Guideline 2.1(b) 대응: IAP products 미제출 상태에서 구독 UI 노출 금지.
// 복원 시: 아래 import 및 <Stack.Screen name="Paywall"> 주석 해제.
// 연관: SettingsScreen "Upgrade to Pro" 버튼, navigation/types.ts Paywall 타입
// ─────────────────────────────────────────────────────────────────────────
// import { PaywallScreen } from '../screens/PaywallScreen'
import { GuideScreen } from '../screens/GuideScreen'
import { TemplatesListScreen } from '../screens/TemplatesListScreen'
import { TemplateEditScreen } from '../screens/TemplateEditScreen'
import { MySharesScreen } from '../screens/MySharesScreen'
import { PublisherStatsScreen } from '../screens/PublisherStatsScreen'
import { AchievementsScreen } from '../screens/AchievementsScreen'
import type { SettingsStackParamList } from './types'

const Stack = createNativeStackNavigator<SettingsStackParamList>()

export function SettingsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="SettingsHome" component={SettingsScreen} />
      <Stack.Screen name="AIGenerate" component={AIGenerateScreen} />
      {/* [SUBSCRIPTION-HIDDEN] Paywall 라우트 — 복원 시 주석 해제 */}
      {/* <Stack.Screen name="Paywall" component={PaywallScreen} /> */}
      <Stack.Screen name="Guide" component={GuideScreen} />
      <Stack.Screen name="TemplatesList" component={TemplatesListScreen} />
      <Stack.Screen name="TemplateEdit" component={TemplateEditScreen} />
      <Stack.Screen name="MyShares" component={MySharesScreen} />
      <Stack.Screen name="PublisherStats" component={PublisherStatsScreen} />
      <Stack.Screen name="Achievements" component={AchievementsScreen} />
    </Stack.Navigator>
  )
}
