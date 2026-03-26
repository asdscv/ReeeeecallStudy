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
import { handleSitemap } from './worker-modules/seo/sitemap.js'
import { handleRobots } from './worker-modules/seo/robots.js'
import { handleRSSFeed } from './worker-modules/seo/feeds.js'
import { getSupabaseAnonKey } from './worker-modules/seo/helpers.js'

const SUPABASE_BASE = 'https://ixdapelfikaneexnskfm.supabase.co/functions/v1/api'

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

    // Dynamic sitemap with edge caching (avoids Supabase latency on every request)
    if (url.pathname === '/sitemap.xml') {
      const cacheKey = new Request(new URL('/sitemap.xml', request.url))
      const cache = caches.default
      let cached = await cache.match(cacheKey)
      if (cached) return cached
      const fresh = await handleSitemap(env)
      if (fresh.ok) {
        const resp = new Response(fresh.body, {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600, s-maxage=86400',
          },
        })
        // Cache at edge for 1 hour
        const toCache = resp.clone()
        toCache.headers.set('Cache-Control', 'public, max-age=3600')
        cache.put(cacheKey, toCache)
        return resp
      }
      return fresh
    }

    // RSS / Atom / JSON feeds (supports ?lang=ko etc.)
    const feedLang = url.searchParams.get('lang') || 'en'
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
      // Bot accessing non-public routes → 404
      else if (!url.pathname.match(/\.\w+$/)) {
        return handleBotNotFound()
      }
    }

    // /api/* → Supabase Edge Function proxy
    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Max-Age': '86400',
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
      responseHeaders.set('Access-Control-Allow-Origin', '*')

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
