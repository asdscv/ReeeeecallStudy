// App store links — single source for the web app and the Worker's crawler HTML.

export const APP_STORE_URL = 'https://apps.apple.com/kr/app/reeeeecallstudy/id6761741123'
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.reeeeecall.study'

export interface StoreAttribution {
  source: string
  medium: string
  campaign: string
  content?: string
}

/**
 * Google Play passes `referrer` through to the install, so Play Console can attribute installs
 * to the page and position that sent them. (The App Store needs a provider token for the same,
 * so its link stays plain.)
 */
export function playStoreUrlWithReferrer(a: StoreAttribution): string {
  const referrer = new URLSearchParams({ utm_source: a.source, utm_medium: a.medium, utm_campaign: a.campaign })
  if (a.content) referrer.set('utm_content', a.content)
  return `${PLAY_STORE_URL}&referrer=${encodeURIComponent(referrer.toString())}`
}
