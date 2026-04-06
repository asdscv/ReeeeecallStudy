import { TouchableOpacity, Text, View, Image, ActivityIndicator, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
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

const providerIcons: Record<SocialProvider, ReturnType<typeof require>> = {
  google: require('../../../assets/google-logo.png'),
  apple: require('../../../assets/apple-logo.png'),
}

export function SocialButton({
  provider,
  onPress,
  loading = false,
  disabled = false,
  testID,
}: SocialButtonProps) {
  const theme = useTheme()
  const { t } = useTranslation('auth')
  const styles = getStyles(theme, provider)
  const label = provider === 'google' ? t('continueWithGoogle') : t('continueWithApple')

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
            <Image
              source={providerIcons[provider]}
              style={[styles.iconImage, provider === 'apple' && { tintColor: '#FFFFFF' }]}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.text}>{label}</Text>
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
    iconImage: {
      width: 20,
      height: 20,
    },
    text: {
      ...typo.button,
      color: isGoogle ? colors.text : (theme.isDark ? colors.text : colors.primaryText),
    },
    disabled: { opacity: 0.5 },
  })
}
