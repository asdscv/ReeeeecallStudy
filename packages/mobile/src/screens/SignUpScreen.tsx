import { useState, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, TextInput as RNTextInput, Linking } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import { Screen, TextInput, Button, Divider, SocialButton } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../theme'
import { validatePassword } from '@reeeeecall/shared/lib/password-validation'

const PRIVACY_POLICY_URL = 'https://reeeeecall.com/privacy'
const TERMS_OF_SERVICE_URL = 'https://reeeeecall.com/terms'

export function SignUpScreen() {
  const theme = useTheme()
  const { t } = useTranslation('auth')
  const navigation = useNavigation()
  const { signUp, signInWithGoogle, signInWithApple, loading } = useAuth()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleGoogleSignUp = async () => {
    setError('')
    const result = await signInWithGoogle()
    if (result.error) setError(result.error)
  }

  const handleAppleSignUp = async () => {
    setError('')
    const result = await signInWithApple()
    if (result.error) setError(result.error)
  }

  const emailRef = useRef<RNTextInput>(null)
  const passwordRef = useRef<RNTextInput>(null)
  const confirmRef = useRef<RNTextInput>(null)

  const passwordValidation = password ? validatePassword(password) : null
  const passwordsMatch = password === confirmPassword
  const canSubmit = displayName.trim() && email.trim() && password && confirmPassword && passwordsMatch && passwordValidation?.valid

  const handleSignUp = async () => {
    setError('')

    if (!displayName.trim()) { setError(t('enterDisplayName')); return }
    if (!email.trim()) { setError(t('enterEmail')); return }
    if (!passwordValidation?.valid) { setError(passwordValidation?.errors[0] ?? 'Invalid password'); return }
    if (!passwordsMatch) { setError(t('passwordsDoNotMatch')); return }

    const result = await signUp(email.trim(), password, displayName.trim())
    if (result.error) {
      setError(result.error)
    } else {
      setSuccess(true)
    }
  }

  if (success) {
    return (
      <Screen testID="signup-success-screen">
        <View style={styles.successContent}>
          <Text style={[theme.typography.h2, { color: theme.colors.text, textAlign: 'center' }]}>
            {t('emailVerification.title')}
          </Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center', marginTop: 12 }]}>
            {t('verificationSent', { email })}
          </Text>
          <Button
            title={t('backToLogin')}
            variant="secondary"
            onPress={() => navigation.goBack()}
            testID="signup-back-to-login"
          />
        </View>
      </Screen>
    )
  }

  return (
    <Screen scroll keyboard testID="signup-screen">
      <View style={styles.content}>
        {/* Card container — matches LoginScreen's card design */}
        <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
          {/* Brand header — matches web: logo + brand name */}
          <View style={styles.brandHeader}>
            <Text style={styles.logoEmoji}>{'\uD83E\uDDE0'}</Text>
            <Text style={[styles.brandText, { color: theme.colors.text }]}>
              <Text style={{ color: theme.colors.primary }}>reeee</Text>callstudy
            </Text>
          </View>

          {/* Title */}
          <Text style={[theme.typography.h3, { color: theme.colors.textSecondary, textAlign: 'center' }]}>
            {t('createAccount')}
          </Text>

          {/* Form — first, matching web order */}
          <View style={styles.form}>
            <TextInput
              testID="signup-name-input"
              placeholder={t('displayNamePlaceholder')}
              value={displayName}
              onChangeText={setDisplayName}
              autoCapitalize="words"
              textContentType="name"
              autoComplete="name"
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
            />

            <TextInput
              ref={emailRef}
              testID="signup-email-input"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />

            <TextInput
              ref={passwordRef}
              testID="signup-password-input"
              placeholder={t('passwordHint')}
              value={password}
              onChangeText={setPassword}
              isPassword
              textContentType="newPassword"
              autoComplete="new-password"
              returnKeyType="next"
              onSubmitEditing={() => confirmRef.current?.focus()}
              error={password && !passwordValidation?.valid ? passwordValidation?.errors[0] : undefined}
            />

            <TextInput
              ref={confirmRef}
              testID="signup-confirm-input"
              placeholder={t('reenterPassword')}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              isPassword
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={handleSignUp}
              error={confirmPassword && !passwordsMatch ? t('passwordsDoNotMatch') : undefined}
            />

            {error ? (
              <Text
                testID="signup-error-text"
                style={[theme.typography.bodySmall, { color: theme.colors.error }]}
              >
                {error}
              </Text>
            ) : null}

            <Text style={[theme.typography.caption, { color: theme.colors.textTertiary, textAlign: 'center' }]}>
              {t('termsAgree')}{' '}
              <Text style={{ color: theme.colors.primary }} onPress={() => Linking.openURL(TERMS_OF_SERVICE_URL)}>
                {t('termsOfService')}
              </Text>
              {' '}{t('and')}{' '}
              <Text style={{ color: theme.colors.primary }} onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
                {t('privacyPolicy')}
              </Text>
            </Text>

            <Button
              testID="signup-submit-button"
              title={t('createAccountButton')}
              onPress={handleSignUp}
              loading={loading}
              disabled={!canSubmit}
            />
          </View>

          <Divider text={t('orDivider')} />

          {/* Social Sign Up — below form with divider, matching web */}
          <View style={styles.socialSection}>
            <SocialButton
              provider="google"
              onPress={handleGoogleSignUp}
              loading={loading}
              testID="signup-google-button"
            />
            <SocialButton
              provider="apple"
              onPress={handleAppleSignUp}
              testID="signup-apple-button"
            />
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
              {t('alreadyHaveAccount')}{' '}
            </Text>
            <TouchableOpacity
              testID="signup-login-link"
              onPress={() => navigation.goBack()}
            >
              <Text style={[theme.typography.label, { color: theme.colors.primary }]}>
                {t('signIn')}
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
  successContent: { flex: 1, justifyContent: 'center', gap: 24, paddingHorizontal: 20 },
  card: { borderRadius: 16, borderWidth: 1, padding: 24, gap: 20 },
  brandHeader: { alignItems: 'center', gap: 8, marginBottom: 4 },
  logoEmoji: { fontSize: 48 },
  brandText: { fontSize: 20, fontWeight: '600', letterSpacing: -0.3 },
  socialSection: { gap: 12 },
  form: { gap: 14 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
})
