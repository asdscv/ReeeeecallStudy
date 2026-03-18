import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
} from 'react-native'
import { useTheme, type Theme } from '../../theme'
import { testProps } from '../../utils/testProps'

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps {
  title: string
  onPress: () => void
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  disabled?: boolean
  icon?: React.ReactNode
  fullWidth?: boolean
  testID?: string
  style?: ViewStyle
  textStyle?: TextStyle
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  fullWidth = true,
  testID,
  style,
  textStyle,
}: ButtonProps) {
  const theme = useTheme()
  const styles = getStyles(theme, variant, size, disabled || loading)

  return (
    <TouchableOpacity
      {...testProps(testID)}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      style={[styles.container, fullWidth && styles.fullWidth, style]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={styles.text.color} />
      ) : (
        <>
          {icon}
          <Text style={[styles.text, textStyle]}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  )
}

function getStyles(theme: Theme, variant: ButtonVariant, size: ButtonSize, isDisabled: boolean) {
  const { colors, borderRadius: br, typography: typo, spacing: sp } = theme

  const bgMap: Record<ButtonVariant, string> = {
    primary: colors.buttonPrimary,
    secondary: colors.buttonSecondary,
    outline: 'transparent',
    ghost: 'transparent',
    danger: colors.error,
  }

  const textColorMap: Record<ButtonVariant, string> = {
    primary: colors.primaryText,
    secondary: colors.text,
    outline: colors.primary,
    ghost: colors.primary,
    danger: colors.primaryText,
  }

  const sizeMap: Record<ButtonSize, { py: number; px: number; text: object }> = {
    sm: { py: sp.sm, px: sp.md, text: typo.buttonSmall ?? typo.labelSmall },
    md: { py: sp.md, px: sp.xl, text: typo.button ?? typo.label },
    lg: { py: sp.lg, px: sp['2xl'], text: typo.button ?? typo.label },
  }

  const s = sizeMap[size]

  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: sp.sm,
      paddingVertical: s.py,
      paddingHorizontal: s.px,
      borderRadius: br.lg,
      backgroundColor: isDisabled ? colors.buttonDisabled : bgMap[variant],
      borderWidth: variant === 'outline' ? 1.5 : 0,
      borderColor: variant === 'outline' ? colors.primary : undefined,
      opacity: isDisabled ? 0.6 : 1,
    },
    fullWidth: { width: '100%' },
    text: {
      ...s.text,
      color: isDisabled ? colors.textTertiary : textColorMap[variant],
    } as TextStyle,
  })
}
