export type DeviceType = 'mobile' | 'tablet' | 'desktop'

const MOBILE_PATTERN = /iphone|ipod|android.*mobile|windows phone|blackberry/i
const TABLET_PATTERN = /ipad|android(?!.*mobile)|tablet/i

/**
 * Determine device type from User-Agent string.
 */
export function getDeviceType(userAgent: string): DeviceType {
  if (MOBILE_PATTERN.test(userAgent)) return 'mobile'
  if (TABLET_PATTERN.test(userAgent)) return 'tablet'
  return 'desktop'
}

/**
 * Categorize viewport width into device category.
 */
export function getViewportCategory(width: number): DeviceType {
  if (width < 768) return 'mobile'
  if (width < 1024) return 'tablet'
  return 'desktop'
}
