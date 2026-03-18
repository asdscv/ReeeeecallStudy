import { TouchableOpacity, Text, View, ActivityIndicator, StyleSheet } from 'react-native'
import { useTheme, type Theme } from '../../theme'
import { testProps } from '../../utils/testProps'

type SocialProvider = 'google' | 'apple'

interface SocialButtonProps {
  provider: SocialProvider
  onPress: () => void
  loading?: boolean
  disabled?: boolean
  testID?: string
}

const providerConfig: Record<SocialProvider, { label: string; icon: string }> = {
  google: { label: 'Continue with Google', icon: 'G' },
  apple: { label: 'Continue with Apple', icon: '' },
}

export function SocialButton({
  provider,
  onPress,
  loading = false,
  disabled = false,
  testID,
}: SocialButtonProps) {
  const theme = useTheme()
  const config = providerConfig[provider]
  const styles = getStyles(theme, provider)

  return (
    <TouchableOpacity
      {...testProps(testID)}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      style={[styles.container, (disabled || loading) && styles.disabled]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={styles.text.color} />
      ) : (
        <>
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>{config.icon}</Text>
          </View>
          <Text style={styles.text}>{config.label}</Text>
        </>
      )}
    </TouchableOpacity>
  )
}

function getStyles(theme: Theme, provider: SocialProvider) {
  const { colors, borderRadius: br, typography: typo, spacing: sp } = theme
  const isGoogle = provider === 'google'

  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: sp.md,
      width: '100%',
      paddingVertical: sp.md,
      paddingHorizontal: sp.xl,
      borderRadius: br.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: isGoogle ? colors.surfaceElevated : (theme.isDark ? colors.surfaceElevated : colors.apple),
    },
    iconContainer: {
      width: 20,
      height: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    icon: {
      fontSize: 18,
      fontWeight: '700' as const,
      color: isGoogle ? colors.google : (theme.isDark ? colors.text : colors.primaryText),
    },
    text: {
      ...typo.button,
      color: isGoogle ? colors.text : (theme.isDark ? colors.text : colors.primaryText),
    },
    disabled: { opacity: 0.5 },
  })
}
