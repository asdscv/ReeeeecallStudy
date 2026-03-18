import { Platform } from 'react-native'

/**
 * Cross-platform test ID helper.
 *
 * iOS:     testID → accessibilityIdentifier (Appium ~ selector works)
 * Android: testID → resource-id, but Appium ~ uses content-description
 *          → must also set accessibilityLabel for ~ selector to work
 *
 * Usage:  <View {...testProps('my-element')} />
 *
 * For container views with children (screens, cards):
 *   <View {...testProps('my-screen', true)} />
 *   → sets accessible=false so children remain individually accessible
 */
export function testProps(id: string | undefined, isContainer = false) {
  if (!id) return {}

  if (Platform.OS === 'android') {
    return {
      testID: id,
      accessible: !isContainer, // containers must be false for children to be accessible
      accessibilityLabel: id,
    }
  }

  return { testID: id }
}
