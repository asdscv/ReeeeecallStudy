import { View, Text, ScrollView, ActivityIndicator, Alert, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { Screen, Button } from '../components/ui'
import { usePurchases } from '../hooks/usePurchases'
import { useTheme } from '../theme'

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
        <View style={styles.center}>
          <Text style={styles.emoji}>✅</Text>
          <Text style={[theme.typography.h2, { color: theme.colors.text }]}>You're Pro!</Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
            You have access to all premium features.
          </Text>
          <Button title="Done" variant="secondary" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    )
  }

  const monthlyPkg = offering?.monthly
  const annualPkg = offering?.annual
  const price = monthlyPkg?.product.priceString ?? '$5.99/mo'

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
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Button title="← Back" variant="ghost" size="sm" fullWidth={false} onPress={() => navigation.goBack()} />
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
            <Button
              testID="paywall-subscribe"
              title={`Subscribe — ${price}`}
              onPress={() => Alert.alert('Setup Required', 'Configure RevenueCat products first.')}
            />
          )}
        </View>

        {/* Restore + Terms */}
        <View style={styles.footer}>
          <Button
            testID="paywall-restore"
            title="Restore Purchase"
            variant="ghost"
            size="sm"
            onPress={handleRestore}
            loading={purchasing}
          />
          <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, textAlign: 'center' }]}>
            Payment will be charged to your Apple/Google account. Subscription auto-renews unless cancelled 24 hours before the current period ends.
          </Text>
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
})
