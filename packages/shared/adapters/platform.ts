/**
 * Platform-agnostic misc platform APIs
 * Web: window.location, document.createElement, etc.
 * Mobile: Linking, Share, etc.
 */
export interface IPlatformAdapter {
  getOrigin(): string
  openURL(url: string): void | Promise<void>
  getLocale(): string
}
