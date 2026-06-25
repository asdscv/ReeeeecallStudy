import { Platform } from 'react-native'

// Store identifiers — kept in sync with eas.json (`ascAppId`) and app.json
// (`android.package`). The remote config may override these per platform.
export const IOS_APP_STORE_ID = '6761741123'
export const ANDROID_PACKAGE = 'com.reeeeecall.study'

/**
 * Default store URL for the current platform. iOS is the fallback for any
 * non-android platform so the button always resolves to something openable.
 */
export function defaultStoreUrl(platform: string = Platform.OS): string {
  if (platform === 'android') {
    return `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`
  }
  return `https://apps.apple.com/app/id${IOS_APP_STORE_ID}`
}
