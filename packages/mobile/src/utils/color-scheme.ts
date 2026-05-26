/**
 * Theme → native appearance mapping. PURE (no RN import) so it's unit-testable.
 *
 * This RN version types `Appearance.setColorScheme` as
 * `ColorSchemeName = 'light' | 'dark' | 'unspecified'` — there is NO `null`.
 * "Follow the OS setting" must be sent as `'unspecified'`; passing `null`
 * (the old API shape) is both a type error and an incorrect runtime value
 * because the JS layer forwards the value straight to the native module.
 */

export type ThemeMode = 'light' | 'dark' | 'system'
export type AppearanceColorScheme = 'light' | 'dark' | 'unspecified'

/** Map the user's theme choice to the value `Appearance.setColorScheme` expects. */
export function toAppearanceColorScheme(theme: ThemeMode): AppearanceColorScheme {
  return theme === 'system' ? 'unspecified' : theme
}
