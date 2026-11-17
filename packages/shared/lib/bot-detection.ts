const BOT_PATTERN = /bot|crawler|spider|crawling|googleother|google-inspectiontool|google-extended|slurp|ia_archiver|sogou|headless|phantomjs|lighthouse|prerender|selenium|playwright|screaming frog|semrush|ahref|yandex|baidu|duckduck|facebookexternalhit|whatsapp|cohere-ai|anthropic-ai|claude-user|claude-web|perplexity-user|chatgpt-user/i

/**
 * Detect bots/crawlers by User-Agent string.
 * Returns true for empty/undefined UA as well (likely automated).
 */
export function isBot(userAgent: string): boolean {
  if (!userAgent) return true
  return BOT_PATTERN.test(userAgent)
}

/**
 * Validate view duration: must be >= 2 seconds and <= 1 hour.
 */
export function isValidViewDuration(ms: number): boolean {
  if (!Number.isFinite(ms)) return false
  return ms >= 2000 && ms <= 3600000
}
