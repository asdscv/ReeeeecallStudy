export const PAGE_ROUTES = [
  {
    pattern: /^\/insight\/(.+)$/,
    handler: 'content-detail',
    extract: (match) => ({ slug: match[1] }),
  },
  {
    pattern: /^\/insight\/?$/,
    handler: 'content-list',
    extract: () => ({}),
  },
  {
    pattern: /^\/(?:landing)?\/?$/,
    handler: 'landing',
    extract: () => ({}),
  },
  {
    pattern: /^\/d\/([^/]+)\/?$/,
    handler: 'listing',
    extract: (match) => ({ listingId: match[1] }),
  },
  {
    pattern: /^\/docs\/api\/?$/,
    handler: 'docs-api',
    extract: () => ({}),
  },
]

export function matchBotRoute(pathname) {
  for (const route of PAGE_ROUTES) {
    const match = pathname.match(route.pattern)
    if (match) {
      return {
        type: route.handler,
        params: route.extract(match),
      }
    }
  }
  return null
}
