import { View, Text, ScrollView, ActivityIndicator, Alert, StyleSheet, Linking, Platform } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { Screen, Button, ScreenHeader } from '../components/ui'
import { usePurchases } from '../hooks/usePurchases'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../theme'

const PRIVACY_POLICY_URL = 'https://reeeeecallstudy.xyz/privacy-policy.html'
const TERMS_OF_SERVICE_URL = 'https://reeeeecallstudy.xyz/terms-of-service.html'
const MANAGE_SUBSCRIPTIONS_URL = Platform.select({
  ios: 'https://apps.apple.com/account/subscriptions',
  default: 'https://play.google.com/store/account/subscriptions',
})

const FEATURES = [
  { icon: '♾️', title: 'Unlimited Decks & Cards', free: '5 decks, 3K cards', pro: 'Unlimited' },
  { icon: '🧠', title: 'All Study Modes', free: 'SRS + Sequential', pro: 'All 4 modes' },
  { icon: '🤖', title: 'AI Card Generation', free: '5/month', pro: 'Unlimited' },
  { icon: '🔊', title: 'Premium TTS', free: 'Basic', pro: 'Edge TTS HD' },
  { icon: '📊', title: 'Advanced Analytics', free: 'Basic stats', pro: 'Charts + Forecast' },
  { icon: '🏪', title: 'Marketplace Publishing', free: 'Download only', pro: 'Upload + Revenue share' },
]

export function PaywallScreen() {
  const theme = useTheme()
  const { t } = useTranslation('paywall')
  const navigation = useNavigation()
  const { isPro, offering, loading, purchasing, purchase, restore } = usePurchases()

  if (loading) {
    return (
      <Screen testID="paywall-screen">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </Screen>
    )
  }

  if (isPro) {
    return (
      <Screen testID="paywall-screen">
        <ScreenHeader title={t('youArePro')} mode="back" />
        <View style={styles.center}>
          <Text style={styles.emoji}>✅</Text>
          <Text style={[theme.typography.h2, { color: theme.colors.text }]}>{t('youArePro')}</Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
            You have access to all premium features.
          </Text>
        </View>
      </Screen>
    )
  }

  const monthlyPkg = offering?.monthly
  const annualPkg = offering?.annual

  const handlePurchase = async (pkg: typeof monthlyPkg) => {
    if (!pkg) {
      Alert.alert('Unavailable', 'This product is not available in your region')
      return
    }
    const result = await purchase(pkg)
    if (result.success) {
      Alert.alert('Welcome to Pro!', 'You now have access to all premium features.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ])
    } else if (result.error && result.error !== 'cancelled') {
      Alert.alert('Error', result.error)
    }
  }

  const handleRestore = async () => {
    const result = await restore()
    if (result.success) {
      Alert.alert('Restored!', 'Your Pro subscription has been restored.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ])
    } else {
      Alert.alert('No Purchase Found', 'No previous subscription was found to restore.')
    }
  }

  return (
    <Screen safeArea padding={false} testID="paywall-screen">
      <ScreenHeader title="Upgrade to Pro" mode="back" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.crown}>👑</Text>
          <Text style={[theme.typography.h1, { color: theme.colors.text, textAlign: 'center' }]}>
            Upgrade to Pro
          </Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
            Unlock the full power of ReeeeecallStudy
          </Text>
        </View>

        {/* Feature Comparison */}
        <View style={styles.features}>
          {FEATURES.map((feat) => (
            <View key={feat.title} style={[styles.featureRow, { borderColor: theme.colors.border }]}>
              <Text style={styles.featureIcon}>{feat.icon}</Text>
              <View style={styles.featureInfo}>
                <Text style={[theme.typography.label, { color: theme.colors.text }]}>{feat.title}</Text>
                <View style={styles.comparisonRow}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}>
                    Free: {feat.free}
                  </Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: '600' }]}>
                    Pro: {feat.pro}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        {/* Pricing */}
        <View style={styles.pricing}>
          {monthlyPkg && (
            <Button
              testID="paywall-monthly"
              title={`Monthly — ${monthlyPkg.product.priceString}`}
              onPress={() => handlePurchase(monthlyPkg)}
              loading={purchasing}
            />
          )}
          {annualPkg && (
            <Button
              testID="paywall-annual"
              title={`Annual — ${annualPkg.product.priceString} (Save 40%)`}
              variant="outline"
              onPress={() => handlePurchase(annualPkg)}
              loading={purchasing}
            />
          )}
          {!monthlyPkg && !annualPkg && (
            <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center', paddingVertical: 16 }]}>
              Subscription products are currently unavailable. Please try again later.
            </Text>
          )}
        </View>

        {/* Restore + Terms */}
        <View style={styles.footer}>
          <Button
            testID="paywall-restore"
            title={t('restorePurchase')}
            variant="ghost"
            size="sm"
            onPress={handleRestore}
            loading={purchasing}
          />
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, textAlign: 'center' }]}>
            Payment will be charged to your {Platform.OS === 'ios' ? 'Apple ID' : 'Google'} account at confirmation of purchase. Subscription automatically renews unless cancelled at least 24 hours before the end of the current period. Your account will be charged for renewal within 24 hours prior to the end of the current period. You can manage and cancel your subscriptions by going to your account settings on the {Platform.OS === 'ios' ? 'App Store' : 'Play Store'} after purchase.
          </Text>
          <View style={styles.legalLinks}>
            <Text
              testID="paywall-privacy-policy"
              style={[theme.typography.caption, { color: theme.colors.primary }]}
              onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
            >
              Privacy Policy
            </Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}> | </Text>
            <Text
              testID="paywall-terms"
              style={[theme.typography.caption, { color: theme.colors.primary }]}
              onPress={() => Linking.openURL(TERMS_OF_SERVICE_URL)}
            >
              Terms of Service
            </Text>
            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary }]}> | </Text>
            <Text
              testID="paywall-manage-subscription"
              style={[theme.typography.caption, { color: theme.colors.primary }]}
              onPress={() => Linking.openURL(MANAGE_SUBSCRIPTIONS_URL)}
            >
              Manage Subscription
            </Text>
          </View>
        </View>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  emoji: { fontSize: 56 },
  header: { alignItems: 'center', gap: 8, paddingTop: 8, paddingBottom: 16 },
  crown: { fontSize: 56, marginBottom: 8 },
  features: { gap: 1 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1 },
  featureIcon: { fontSize: 24, width: 36, textAlign: 'center' },
  featureInfo: { flex: 1, gap: 4 },
  comparisonRow: { flexDirection: 'row', gap: 12 },
  pricing: { gap: 10, marginTop: 24 },
  footer: { gap: 12, marginTop: 24, alignItems: 'center' },
  legalLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' },
})
