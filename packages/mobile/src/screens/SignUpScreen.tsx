import { useState, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, TextInput as RNTextInput } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { Screen, TextInput, Button } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../theme'
import { validatePassword } from '@reeeeecall/shared/lib/password-validation'

export function SignUpScreen() {
  const theme = useTheme()
  const navigation = useNavigation()
  const { signUp, loading } = useAuth()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const emailRef = useRef<RNTextInput>(null)
  const passwordRef = useRef<RNTextInput>(null)
  const confirmRef = useRef<RNTextInput>(null)

  const passwordValidation = password ? validatePassword(password) : null
  const passwordsMatch = password === confirmPassword
  const canSubmit = displayName.trim() && email.trim() && password && confirmPassword && passwordsMatch && passwordValidation?.valid

  const handleSignUp = async () => {
    setError('')

    if (!displayName.trim()) { setError('Please enter a display name'); return }
    if (!email.trim()) { setError('Please enter your email'); return }
    if (!passwordValidation?.valid) { setError(passwordValidation?.errors[0] ?? 'Invalid password'); return }
    if (!passwordsMatch) { setError('Passwords do not match'); return }

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
            Check your email
          </Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, textAlign: 'center', marginTop: 12 }]}>
            We sent a verification link to {email}. Click the link to activate your account.
          </Text>
          <Button
            title="Back to Login"
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
        {/* Header */}
        <View style={styles.header}>
          <Text style={[theme.typography.h1, { color: theme.colors.text }]}>Create account</Text>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary, marginTop: theme.spacing.sm }]}>
            Start your learning journey
          </Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <TextInput
            testID="signup-name-input"
            label="Display Name"
            placeholder="Your name"
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
            label="Email"
            placeholder="you@example.com"
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
            label="Password"
            placeholder="Min 8 chars, letter + number + symbol"
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
            label="Confirm Password"
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            isPassword
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={handleSignUp}
            error={confirmPassword && !passwordsMatch ? 'Passwords do not match' : undefined}
          />

          {error ? (
            <Text
              testID="signup-error-text"
              style={[theme.typography.bodySmall, { color: theme.colors.error }]}
            >
              {error}
            </Text>
          ) : null}

          <Button
            testID="signup-submit-button"
            title="Create Account"
            onPress={handleSignUp}
            loading={loading}
            disabled={!canSubmit}
          />
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={[theme.typography.body, { color: theme.colors.textSecondary }]}>
            Already have an account?{' '}
          </Text>
          <TouchableOpacity
            testID="signup-login-link"
            onPress={() => navigation.goBack()}
          >
            <Text style={[theme.typography.label, { color: theme.colors.primary }]}>
              Sign In
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', gap: 24, paddingVertical: 40 },
  successContent: { flex: 1, justifyContent: 'center', gap: 24, paddingHorizontal: 20 },
  header: { alignItems: 'center' },
  form: { gap: 16 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
})
