export const SITE_URL = 'https://reklue.com'
export const LEGACY_SITE_HOST = 'reeeeecallstudy.xyz'

/** Move only our old web address; preserve paths, query values and other sites. */
export function currentSiteAddress(value: string): string {
  return value.replace(
    /^https?:\/\/(?:www\.)?reeeeecallstudy\.xyz(?=\/|\?|#|$)/i,
    SITE_URL,
  )
}
