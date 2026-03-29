import { type ReactNode } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native'
import { useNavigation, DrawerActions } from '@react-navigation/native'
import { useTheme } from '../../theme'

interface RightAction {
  title: string
  onPress: () => void
  loading?: boolean
  disabled?: boolean
  testID?: string
}

interface ScreenHeaderProps {
  title: string
  mode: 'drawer' | 'back'
  onBack?: () => void
  rightAction?: RightAction
  rightContent?: ReactNode
  testID?: string
}

export function ScreenHeader({
  title,
  mode,
  onBack,
  rightAction,
  rightContent,
  testID,
}: ScreenHeaderProps) {
  const theme = useTheme()
  const navigation = useNavigation()

  const handleLeftPress = () => {
    if (mode === 'drawer') {
      navigation.dispatch(DrawerActions.openDrawer())
    } else {
      onBack ? onBack() : navigation.goBack()
    }
  }

  const leftIcon = mode === 'drawer' ? '\u2630' : '\u2190'
  const leftLabel = mode === 'drawer' ? 'Open menu' : 'Go back'

  const renderRight = () => {
    if (rightAction) {
      const { title: actionTitle, onPress, loading, disabled, testID: actionTestID } = rightAction
      return (
        <TouchableOpacity
          onPress={onPress}
          disabled={disabled || loading}
          style={[styles.rightBtn, (disabled || loading) && { opacity: 0.5 }]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          testID={actionTestID}
        >
          {loading ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <Text style={[styles.rightBtnText, { color: theme.colors.primary }]}>
              {actionTitle}
            </Text>
          )}
        </TouchableOpacity>
      )
    }
    if (rightContent) return <>{rightContent}</>
    return <View style={styles.spacer} />
  }

  return (
    <View
      style={[styles.container, { borderBottomColor: theme.colors.border }]}
      testID={testID}
    >
      <TouchableOpacity
        onPress={handleLeftPress}
        style={styles.leftBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityLabel={leftLabel}
        accessibilityRole="button"
      >
        <Text style={[styles.leftIcon, { color: theme.colors.text }]}>
          {leftIcon}
        </Text>
      </TouchableOpacity>
      <Text
        style={[styles.title, { color: theme.colors.text }]}
        numberOfLines={1}
      >
        {title}
      </Text>
      {renderRight()}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  leftBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leftIcon: { fontSize: 22 },
  title: { flex: 1, fontSize: 18, fontWeight: '600' },
  spacer: { width: 32 },
  rightBtn: {
    minWidth: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  rightBtnText: { fontSize: 15, fontWeight: '600' },
})
