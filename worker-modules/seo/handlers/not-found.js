// Bot 404 handler — extracted from worker.js bot not-found response
import { SITE_URL, BRAND_NAME } from '../constants.js'

export function handleBotNotFound() {
  return new Response(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="robots" content="noindex, nofollow">
<title>404 — Page Not Found | ${BRAND_NAME}</title>
<link rel="canonical" href="${SITE_URL}/landing">
</head><body>
<h1>404 — Page Not Found</h1>
<p>The page you are looking for does not exist.</p>
<p><a href="${SITE_URL}/landing">Go to ${BRAND_NAME} homepage</a></p>
<p><a href="${SITE_URL}/insight">Browse Learning Insights</a></p>
</body></html>`, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
