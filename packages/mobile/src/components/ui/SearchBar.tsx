import { View, TextInput, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme'
import { testProps } from '../../utils/testProps'

interface SearchBarProps {
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
  testID?: string
}

export function SearchBar({ value, onChangeText, placeholder, testID }: SearchBarProps) {
  const theme = useTheme()
  const { t } = useTranslation('common')

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
      <TextInput
        testID={testID}
        accessibilityLabel={testID}
        style={[theme.typography.body, styles.input, { color: theme.colors.text }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? t('searchPlaceholder')}
        placeholderTextColor={theme.colors.inputPlaceholder}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    minHeight: 42,
    justifyContent: 'center',
  },
  input: { paddingVertical: 8 },
})
