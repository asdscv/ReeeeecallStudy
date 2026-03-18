import {
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../../theme'
import { testProps } from '../../utils/testProps'

interface ScreenProps {
  children: React.ReactNode
  scroll?: boolean
  keyboard?: boolean
  padding?: boolean
  safeArea?: boolean
  style?: ViewStyle
  contentContainerStyle?: ViewStyle
  testID?: string
}

export function Screen({
  children,
  scroll = false,
  keyboard = false,
  padding = true,
  safeArea = true,
  style,
  contentContainerStyle,
  testID,
}: ScreenProps) {
  const theme = useTheme()
  const bg = { backgroundColor: theme.colors.background }
  const pad = padding ? { paddingHorizontal: theme.spacing.xl } : {}

  const Wrapper = safeArea ? SafeAreaView : View
  let content = <View style={[styles.flex, pad, contentContainerStyle]}>{children}</View>

  if (scroll) {
    content = (
      <ScrollView
        contentContainerStyle={[styles.scrollContent, pad, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    )
  }

  if (keyboard) {
    content = (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        {content}
      </KeyboardAvoidingView>
    )
  }

  return (
    <Wrapper style={[styles.flex, bg, style]} {...testProps(testID, true)}>
      {content}
    </Wrapper>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },
})
