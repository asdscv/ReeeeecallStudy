import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
} from 'react-native'
import { useTheme, type Theme } from '../../theme'

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
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      style={[styles.container, fullWidth && styles.fullWidth, style]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? theme.colors.primaryText : theme.colors.primary}
        />
      ) : (
        <>
          {icon}
          <Text style={[styles.text, textStyle]}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  )
}

function getStyles(theme: Theme, variant: ButtonVariant, size: ButtonSize, disabled: boolean) {
  const { colors, borderRadius: br, typography: typo, spacing: sp } = theme

  const sizeMap = {
    sm: { paddingVertical: sp.sm, paddingHorizontal: sp.lg, ...typo.buttonSmall },
    md: { paddingVertical: sp.md, paddingHorizontal: sp.xl, ...typo.button },
    lg: { paddingVertical: sp.lg, paddingHorizontal: sp['2xl'], ...typo.button },
  }

  const variantMap: Record<ButtonVariant, { bg: string; text: string; border?: string }> = {
    primary: { bg: disabled ? colors.buttonDisabled : colors.buttonPrimary, text: colors.primaryText },
    secondary: { bg: colors.buttonSecondary, text: colors.text },
    outline: { bg: 'transparent', text: colors.primary, border: colors.border },
    ghost: { bg: 'transparent', text: colors.primary },
    danger: { bg: disabled ? colors.buttonDisabled : colors.error, text: colors.primaryText },
  }

  const v = variantMap[variant]
  const s = sizeMap[size]

  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: sp.sm,
      backgroundColor: v.bg,
      borderRadius: br.lg,
      paddingVertical: s.paddingVertical,
      paddingHorizontal: s.paddingHorizontal,
      ...(v.border ? { borderWidth: 1, borderColor: v.border } : {}),
      opacity: disabled ? 0.5 : 1,
    },
    fullWidth: { width: '100%' },
    text: {
      fontSize: s.fontSize,
      fontWeight: s.fontWeight as TextStyle['fontWeight'],
      lineHeight: s.lineHeight,
      color: v.text,
    },
  })
}
