import { View, Text, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { useTheme } from '../../theme'
import { Button } from './Button'

// ─────────────────────────────────────────────────────────────────────────
// [SUBSCRIPTION-HIDDEN] 2026-04-15 — Apple 심사 리젝 대응
// 이 컴포넌트는 현재 어디서도 호출되지 않음 (export만 유지, 미사용).
// Paywall 라우트가 주석 처리된 상태라 호출 시 네비게이션 에러 발생함.
// 구독 기능 복원 시 Paywall 라우트 부활과 함께 사용 가능.
// ─────────────────────────────────────────────────────────────────────────

interface UpgradePromptProps {
  feature: string
  description?: string
  testID?: string
}

/**
 * Reusable upgrade prompt — shown when user hits a free-tier limit.
 * Drop this into any screen where a Pro feature is gated.
 */
export function UpgradePrompt({ feature, description, testID }: UpgradePromptProps) {
  const theme = useTheme()
  const navigation = useNavigation<any>()

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.primaryLight, borderColor: theme.colors.primary }]} testID={testID}>
      <Text style={styles.icon}>👑</Text>
      <Text style={[theme.typography.label, { color: theme.colors.primary }]}>
        Pro Feature: {feature}
      </Text>
      {description && (
        <Text style={[theme.typography.bodySmall, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
          {description}
        </Text>
      )}
      <Button
        title="Upgrade to Pro"
        size="sm"
        onPress={() => navigation.navigate('SettingsTab', { screen: 'Paywall' })}
        testID={testID ? `${testID}-upgrade` : undefined}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    gap: 8,
  },
  icon: { fontSize: 32 },
})
