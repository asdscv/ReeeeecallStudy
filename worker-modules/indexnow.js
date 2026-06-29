// IndexNow — instant URL submission to Bing, Yandex, Naver, Seznam
// https://www.indexnow.org/documentation

import { info, warn } from './logger.js'

const INDEXNOW_ENDPOINTS = [
  'https://api.indexnow.org/indexnow',   // Bing, DuckDuckGo, Yandex
  'https://searchadvisor.naver.com/indexnow',  // Naver
]

const SITE_URL = 'https://reeeeecallstudy.xyz'

/**
 * Submit newly published URLs to IndexNow-compatible search engines.
 * Requires INDEXNOW_KEY env variable (generate at https://www.indexnow.org/)
 */
export async function submitToIndexNow(env, urls) {
  const key = env.INDEXNOW_KEY
  if (!key) {
    warn('INDEXNOW_KEY not set, skipping IndexNow submission')
    return
  }

  if (!urls || urls.length === 0) return

  const body = JSON.stringify({
    host: 'reeeeecallstudy.xyz',
    key,
    keyLocation: `${SITE_URL}/${key}.txt`,
    urlList: urls,
  })

  const results = await Promise.allSettled(
    INDEXNOW_ENDPOINTS.map(async (endpoint) => {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      return { endpoint, status: res.status }
    }),
  )

  for (const r of results) {
    if (r.status === 'fulfilled') {
      info('IndexNow submitted', r.value)
    } else {
      warn('IndexNow failed', { error: r.reason?.message })
    }
  }
}

// NOTE: Google (June 2023) and Bing both retired their `/ping?sitemap=`
// endpoints, so there is no push path to Google for new content — discovery
// relies on crawl + sitemap. IndexNow above still notifies Bing/Yandex/Naver.
