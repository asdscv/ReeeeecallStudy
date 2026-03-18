import { TouchableOpacity, View, Text, StyleSheet, type ViewStyle } from 'react-native'
import { useTheme } from '../../theme'
import { testProps } from '../../utils/testProps'

interface ListCardProps {
  onPress?: () => void
  children: React.ReactNode
  style?: ViewStyle
  testID?: string
}

export function ListCard({ onPress, children, style, testID }: ListCardProps) {
  const theme = useTheme()

  const cardStyle = [
    styles.card,
    {
      backgroundColor: theme.colors.surfaceElevated,
      borderColor: theme.colors.border,
    },
    style,
  ]

  if (onPress) {
    return (
      <TouchableOpacity {...testProps(testID)} onPress={onPress} activeOpacity={0.7} style={cardStyle}>
        {children}
      </TouchableOpacity>
    )
  }

  return (
    <View {...testProps(testID)} style={cardStyle}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
})
