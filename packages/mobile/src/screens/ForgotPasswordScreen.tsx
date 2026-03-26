import { useState } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { Screen, TextInput, Button } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../theme'

export function ForgotPasswordScreen() {
  const theme = useTheme()
  const { t } = useTranslation('auth')
  const navigation = useNavigation()
  const { resetPassword, loading } = useAuth()

  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const handleReset = async () => {
    setError('')

    if (!email.trim()) {
      setError(t('enterEmail'))
      return
    }

    const result = await resetPassword(email.trim())
    if (result.error) {
      setError(result.error)
    } else {
      setSent(true)
    }
  }

  if (sent) {
    return (
      <Screen testID="forgot-password-success-screen">
        <View style={styles.content}>
          <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
            {/* Brand header */}
            <View style={styles.brandHeader}>
              <Image source={require('../../assets/logo-icon.png')} style={styles.logoIcon} resizeMode="contain" />
              <Image source={require('../../assets/logo-text.png')} style={styles.logoTextImg} resizeMode="contain" />
            </View>

            <Text style={[theme.typography.h2, { color: theme.colors.text, textAlign: 'center' }]}>
              {t('resetSentTitle')}
            </Text>
            <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
              {t('resetSentMessage', { email })}
            </Text>
            <Button
              title={t('backToLogin')}
              variant="secondary"
              onPress={() => navigation.goBack()}
              testID="forgot-password-back-button"
            />
          </View>
        </View>
      </Screen>
    )
  }

  return (
    <Screen scroll keyboard testID="forgot-password-screen">
      <View style={styles.content}>
        {/* Card container — matches LoginScreen rounded card */}
        <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
          {/* Brand header — matches web: icon + text logo */}
          <View style={styles.brandHeader}>
            <Image source={require('../../assets/logo-icon.png')} style={styles.logoIcon} resizeMode="contain" />
            <Image source={require('../../assets/logo-text.png')} style={styles.logoTextImg} resizeMode="contain" />
          </View>

          {/* Title */}
          <Text style={[theme.typography.h3, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
            {t('resetPassword')}
          </Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
            {t('resetDescription')}
          </Text>

          {/* Form */}
          <View style={styles.form}>
            <TextInput
              testID="forgot-password-email-input"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              returnKeyType="done"
              onSubmitEditing={handleReset}
            />

            {error ? (
              <Text
                testID="forgot-password-error-text"
                style={[theme.typography.bodySmall, { color: theme.colors.error }]}
              >
                {error}
              </Text>
            ) : null}

            <Button
              testID="forgot-password-submit-button"
              title={t('sendResetLink')}
              onPress={handleReset}
              loading={loading}
              disabled={!email.trim()}
            />
          </View>

          {/* Back to login link */}
          <View style={styles.footer}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              testID="forgot-password-back"
            >
              <Text style={[theme.typography.body, { color: theme.colors.primary }]}>
                {'← '}{t('backToLogin', { ns: 'common', defaultValue: 'Back to Login' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', paddingVertical: 40 },
  card: { borderRadius: 16, borderWidth: 1, padding: 24, gap: 20 },
  brandHeader: { alignItems: 'center', gap: 10, marginBottom: 4 },
  logoIcon: { width: 56, height: 56 },
  logoTextImg: { height: 32, width: 180 },
  form: { gap: 14 },
  footer: { alignItems: 'center' },
})
