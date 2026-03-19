import { useState, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, TextInput as RNTextInput } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useTranslation } from 'react-i18next'
import { Screen, TextInput, Button, Divider, SocialButton } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../theme'
import type { AuthStackParamList } from '../navigation/types'

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Login'>

export function LoginScreen() {
  const theme = useTheme()
  const { t } = useTranslation('auth')
  const navigation = useNavigation<Nav>()
  const { signIn, signInWithGoogle, signInWithApple, loading } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const passwordRef = useRef<RNTextInput>(null)

  const handleLogin = async () => {
    setError('')

    if (!email.trim()) {
      setError(t('enterEmail'))
      return
    }
    if (!password) {
      setError(t('enterPasswordError'))
      return
    }

    const result = await signIn(email.trim(), password)
    if (result.error) {
      setError(result.error)
    }
  }

  const handleGoogleLogin = async () => {
    setError('')
    const result = await signInWithGoogle()
    if (result.error) {
      setError(result.error)
    }
  }

  const handleAppleLogin = async () => {
    setError('')
    const result = await signInWithApple()
    if (result.error) {
      setError(result.error)
    }
  }

  return (
    <Screen scroll keyboard testID="login-screen">
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[theme.typography.h1, { color: theme.colors.text }]}>
            {t('welcomeBack')}
          </Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, marginTop: theme.spacing.sm }]}>
            {t('signInToContinue')}
          </Text>
        </View>

        {/* Social Login */}
        <View style={styles.socialSection}>
          <SocialButton
            provider="google"
            onPress={handleGoogleLogin}
            loading={loading}
            testID="login-google-button"
          />
          <SocialButton
            provider="apple"
            onPress={handleAppleLogin}
            testID="login-apple-button"
          />
        </View>

        <Divider text={t('orDivider')} />

        {/* Email Login */}
        <View style={styles.form}>
          <TextInput
            testID="login-email-input"
            label={t('emailLabel')}
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
            testID="login-password-input"
            label={t('passwordLabel')}
            placeholder={t('enterPassword')}
            value={password}
            onChangeText={setPassword}
            isPassword
            textContentType="password"
            autoComplete="password"
            returnKeyType="done"
            onSubmitEditing={handleLogin}
          />

          {error ? (
            <Text
              testID="login-error-text"
              style={[theme.typography.bodySmall, { color: theme.colors.error }]}
            >
              {error}
            </Text>
          ) : null}

          <Button
            testID="login-submit-button"
            title={t('signIn')}
            onPress={handleLogin}
            loading={loading}
            disabled={!email.trim() || !password}
          />

          <TouchableOpacity
            testID="login-forgot-password"
            onPress={() => navigation.navigate('ForgotPassword')}
            style={styles.linkButton}
          >
            <Text style={[theme.typography.bodySmall, { color: theme.colors.primary }]}>
              {t('forgotPasswordLink')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
            {t('noAccount')}{' '}
          </Text>
          <TouchableOpacity
            testID="login-signup-link"
            onPress={() => navigation.navigate('SignUp')}
          >
            <Text style={[theme.typography.label, { color: theme.colors.primary }]}>
              {t('signup')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', gap: 24, paddingVertical: 40 },
  header: { alignItems: 'center' },
  socialSection: { gap: 12 },
  form: { gap: 16 },
  linkButton: { alignSelf: 'center', padding: 8 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
})
