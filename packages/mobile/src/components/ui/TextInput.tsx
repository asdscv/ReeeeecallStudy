import { useState, forwardRef } from 'react'
import {
  View,
  TextInput as RNTextInput,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  type TextInputProps as RNTextInputProps,
  type ViewStyle,
} from 'react-native'
import { useTheme, type Theme } from '../../theme'
import { testProps } from '../../utils/testProps'

interface TextInputProps extends Omit<RNTextInputProps, 'style'> {
  label?: string
  error?: string
  hint?: string
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  isPassword?: boolean
  containerStyle?: ViewStyle
  testID?: string
}

export const TextInput = forwardRef<RNTextInput, TextInputProps>(
  function TextInput(
    {
      label,
      error,
      hint,
      leftIcon,
      rightIcon,
      isPassword = false,
      containerStyle,
      testID,
      ...rest
    },
    ref,
  ) {
    const theme = useTheme()
    const [focused, setFocused] = useState(false)
    const [secureVisible, setSecureVisible] = useState(!isPassword)

    const styles = getStyles(theme, !!error, focused)

    return (
      <View style={[styles.wrapper, containerStyle]} {...(Platform.OS === 'android' ? testProps(testID, true) : {})}>
        {label && <Text style={styles.label}>{label}</Text>}
        <View style={styles.container}>
          {leftIcon && <View style={styles.icon}>{leftIcon}</View>}
          <RNTextInput
            ref={ref}
            testID={testID}
            accessibilityLabel={testID}
            style={styles.input}
            placeholderTextColor={theme.colors.inputPlaceholder}
            secureTextEntry={isPassword && !secureVisible}
            onFocus={(e) => {
              setFocused(true)
              rest.onFocus?.(e)
            }}
            onBlur={(e) => {
              setFocused(false)
              rest.onBlur?.(e)
            }}
            {...rest}
          />
          {isPassword && (
            <TouchableOpacity
              onPress={() => setSecureVisible(!secureVisible)}
              style={styles.icon}
              {...testProps(testID ? `${testID}-toggle` : undefined)}
            >
              <Text style={styles.toggleText}>{secureVisible ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          )}
          {rightIcon && <View style={styles.icon}>{rightIcon}</View>}
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        {hint && !error && <Text style={styles.hint}>{hint}</Text>}
      </View>
    )
  },
)

function getStyles(theme: Theme, hasError: boolean, focused: boolean) {
  const { colors, spacing: sp, borderRadius: br, typography: typo } = theme

  const borderColor = hasError
    ? colors.error
    : focused
      ? colors.borderFocused
      : colors.inputBorder

  return StyleSheet.create({
    wrapper: { gap: sp.xs },
    label: { ...typo.label, color: colors.text },
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.inputBackground,
      borderWidth: 1.5,
      borderColor,
      borderRadius: br.lg,
      paddingHorizontal: sp.lg,
      minHeight: 48,
    },
    input: {
      flex: 1,
      ...typo.body,
      color: colors.text,
      paddingVertical: sp.md,
    },
    icon: { marginHorizontal: sp.xs },
    toggleText: { ...typo.labelSmall, color: colors.primary },
    error: { ...typo.caption, color: colors.error, marginLeft: sp.xs },
    hint: { ...typo.caption, color: colors.textSecondary, marginLeft: sp.xs },
  })
}
