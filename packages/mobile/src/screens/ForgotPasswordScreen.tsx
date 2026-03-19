import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
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
        <View style={styles.successContent}>
          <Text style={[theme.typography.h2, { color: theme.colors.text, textAlign: 'center' }]}>
            {t('resetSentTitle')}
          </Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center', marginTop: 12 }]}>
            {t('resetSentMessage', { email })}
          </Text>
          <Button
            title={t('backToLogin')}
            variant="secondary"
            onPress={() => navigation.goBack()}
            testID="forgot-password-back-button"
          />
        </View>
      </Screen>
    )
  }

  return (
    <Screen scroll keyboard testID="forgot-password-screen">
      <View style={styles.content}>
        {/* Back button */}
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          testID="forgot-password-back"
        >
          <Text style={[theme.typography.body, { color: theme.colors.primary }]}>
            {'← '}{t('backToLogin', { ns: 'common', defaultValue: 'Back' })}
          </Text>
        </TouchableOpacity>

        {/* Header */}
        <View style={styles.header}>
          <Text style={[theme.typography.h1, { color: theme.colors.text }]}>
            {t('resetPassword')}
          </Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, marginTop: theme.spacing.sm }]}>
            {t('resetDescription')}
          </Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <TextInput
            testID="forgot-password-email-input"
            label={t('emailLabel')}
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
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', gap: 24, paddingVertical: 40 },
  successContent: { flex: 1, justifyContent: 'center', gap: 24, paddingHorizontal: 20 },
  backButton: { alignSelf: 'flex-start', padding: 8 },
  header: { alignItems: 'center' },
  form: { gap: 16 },
})
