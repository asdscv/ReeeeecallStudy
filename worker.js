// Cloudflare Worker — Thin router (SEO modules in worker-modules/seo/)
import { runContentPipeline } from './worker-modules/content-pipeline.js'
import { sendReminders } from './worker-modules/reminder-sender.js'
import { isBot } from './worker-modules/seo/bot-detector.js'
import { matchBotRoute } from './worker-modules/seo/page-registry.js'
import { handleContentDetailBot } from './worker-modules/seo/handlers/content-detail.js'
import { handleContentListBot } from './worker-modules/seo/handlers/content-list.js'
import { handleLandingBotRequest } from './worker-modules/seo/handlers/landing.js'
import { handleListingBotRequest } from './worker-modules/seo/handlers/listing.js'
import { handleBotNotFound } from './worker-modules/seo/handlers/not-found.js'
import { handleSitemap, handleSitemapStatic, handleSitemapArticles, handleSitemapListings } from './worker-modules/seo/sitemap.js'
import { handleRobots } from './worker-modules/seo/robots.js'
import { handleRSSFeed } from './worker-modules/seo/feeds.js'
import { getSupabaseAnonKey } from './worker-modules/seo/helpers.js'
import { isUiLocale } from './worker-modules/locale-policy.js'

const SUPABASE_BASE = 'https://ixdapelfikaneexnskfm.supabase.co/functions/v1/api'

// L4/L5: the worker fronts /api/* for browsers, so it (not the edge function) is
// the real CORS boundary. Echo only allowlisted origins; for anything else
// return our canonical origin (≠ caller → the browser blocks). Non-browser
// callers (server-side rc_ consumers) ignore CORS. Keep in sync with the
// ALLOWED_ORIGINS default in supabase/functions/{api,tts}/index.ts.
const ALLOWED_ORIGINS = ['https://reeeeecallstudy.xyz', 'http://localhost:5173']
function corsAllowOrigin(request) {
  const origin = request.headers.get('Origin')
  return origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
}

// Extensionless legal pages. Cloudflare Assets serves the real
// /privacy-policy.html and /terms-of-service.html at these clean URLs (verified:
// 200 with the real page body), but the bot 404 branch below would otherwise
// reject the extensionless form. Let bots fall through to ASSETS for the real page.
const SPA_BOT_PASSTHROUGH = new Set(['/privacy-policy', '/terms-of-service'])

// ─── Bot handler dispatch ────────────────────────────────────────────────────

const BOT_HANDLERS = {
  'content-detail': (params, url, env) => handleContentDetailBot(params.slug, url, env),
  'content-list': (_params, url, env) => handleContentListBot(url, env),
  'landing': (_params, url) => handleLandingBotRequest(url),
  'listing': (params, url, env) => handleListingBotRequest(params.listingId, url, env),
}

// ─── Main Worker ─────────────────────────────────────────────────────────────

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runContentPipeline(env, event.cron))
    ctx.waitUntil(sendReminders(env))
  },

  async fetch(request, env) {
    const url = new URL(request.url)
    const ua = request.headers.get('user-agent') || ''

    // Trailing slash redirect — prevent duplicate content (except root)
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      const cleanUrl = new URL(url)
      cleanUrl.pathname = url.pathname.slice(0, -1)
      return new Response(null, {
        status: 301,
        headers: { Location: cleanUrl.toString() },
      })
    }

    // Static HTML pages (privacy policy, terms) — serve directly from assets
    if (url.pathname.endsWith('.html') && url.pathname !== '/index.html') {
      return env.ASSETS.fetch(request)
    }

    // Sitemaps — index + sub-sitemaps (cached via Cache-Control headers)
    const sitemapHandlers = {
      '/sitemap.xml': () => handleSitemap(),
      '/sitemap-static.xml': () => handleSitemapStatic(),
      '/sitemap-articles.xml': () => handleSitemapArticles(env),
      '/sitemap-listings.xml': () => handleSitemapListings(env),
    }
    const sitemapHandler = sitemapHandlers[url.pathname]
    if (sitemapHandler) {
      return sitemapHandler()
    }

    // RSS / Atom / JSON feeds (supports ?lang=ko etc.) — normalize ?lang against
    // the registry so it can't inject into the feed's PostgREST locale filter.
    const rawFeedLang = url.searchParams.get('lang')
    const feedLang = isUiLocale(rawFeedLang) ? rawFeedLang : 'en'
    if (url.pathname === '/feed.xml' || url.pathname === '/rss.xml' || url.pathname === '/feed') {
      return handleRSSFeed(env, 'rss', feedLang)
    }
    if (url.pathname === '/feed.atom' || url.pathname === '/atom.xml') {
      return handleRSSFeed(env, 'atom', feedLang)
    }
    if (url.pathname === '/feed.json') {
      return handleRSSFeed(env, 'json', feedLang)
    }

    // IndexNow key verification
    if (env.INDEXNOW_KEY && url.pathname === `/${env.INDEXNOW_KEY}.txt`) {
      return new Response(env.INDEXNOW_KEY, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
      })
    }

    // llms.txt — fall through to asset serving
    if (url.pathname === '/llms.txt' || url.pathname === '/llms-full.txt') {
      // Served from static assets
    }

    // robots.txt
    if (url.pathname === '/robots.txt') {
      return handleRobots(env)
    }

    // ── Bot prerendering (SEO + AEO) ──
    if (isBot(ua)) {
      const match = matchBotRoute(url.pathname)
      if (match) {
        const handler = BOT_HANDLERS[match.type]
        if (handler) {
          // Content handlers need anonKey check
          if (match.type === 'content-detail' || match.type === 'content-list') {
            const anonKey = getSupabaseAnonKey(env)
            if (!anonKey) return new Response('Bot prerendering not configured', { status: 500 })
          }
          const result = await handler(match.params, url, env)
          if (result) return result
          // If handler returns null (e.g., article not found), return 404
          if (match.type !== 'listing') {
            return handleBotNotFound()
          }
        }
        // docs-api and other types fall through to SPA
      }
      // Known clean-URL static pages → fall through to ASSETS for the real
      // .html (served at the clean URL by Cloudflare), not a 404
      else if (!url.pathname.match(/\.\w+$/) && !SPA_BOT_PASSTHROUGH.has(url.pathname)) {
        return handleBotNotFound()
      }
    }

    // /api/* → Supabase Edge Function proxy
    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': corsAllowOrigin(request),
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Max-Age': '86400',
            'Vary': 'Origin',
          },
        })
      }

      const subpath = url.pathname.slice('/api/'.length)
      const target = `${SUPABASE_BASE}/${subpath}${url.search}`

      const headers = new Headers(request.headers)
      headers.delete('host')

      const res = await fetch(target, {
        method: request.method,
        headers,
        body: request.method !== 'GET' && request.method !== 'HEAD'
          ? request.body
          : undefined,
      })

      const responseHeaders = new Headers(res.headers)
      responseHeaders.set('Access-Control-Allow-Origin', corsAllowOrigin(request))
      responseHeaders.append('Vary', 'Origin')

      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
      })
    }

    // Static assets + SPA fallback
    return env.ASSETS.fetch(request)
  },
}
