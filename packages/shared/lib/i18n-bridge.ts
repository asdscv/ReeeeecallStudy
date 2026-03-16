/**
 * Bridge to get the current i18n language.
 * Each platform initializes this with their i18n instance.
 */
let _getLanguage: () => string = () => 'en'

export function initI18nBridge(getLanguage: () => string): void {
  _getLanguage = getLanguage
}

export function getCurrentLanguage(): string {
  return _getLanguage()
}
