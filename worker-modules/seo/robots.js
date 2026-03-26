// robots.txt handler — refactored from worker.js with data-driven approach
import { SITE_URL } from './constants.js'

const PUBLIC_PATHS = ['/landing', '/insight', '/insight/*', '/d/', '/d/*']
const PRIVATE_PATHS = ['/docs/', '/auth/', '/decks/', '/settings', '/history', '/quick-study', '/marketplace', '/my-shares', '/templates', '/admin', '/api-docs', '/api/', '/dashboard']
const AI_BOTS = ['ChatGPT-User', 'GPTBot', 'OAI-SearchBot', 'PerplexityBot', 'ClaudeBot', 'Google-Extended', 'Bytespider', 'Amazonbot', 'Meta-ExternalAgent', 'Cohere-ai', 'YouBot', 'iaskspider', 'anthropic-ai']
const SEO_TOOLS = ['Semrushbot', 'Ahrefsbot']

function buildAllowRules(paths) {
  return paths.map((p) => `Allow: ${p}`).join('\n')
}

function buildDisallowRules(paths) {
  return paths.map((p) => `Disallow: ${p}`).join('\n')
}

/**
 * Build a bot-specific block that allows public paths and disallows everything else.
 */
function buildAiBotBlock(botName) {
  return `User-agent: ${botName}
${buildAllowRules(PUBLIC_PATHS)}
Disallow: /`
}

export function handleRobots(env) {
  const sections = []

  // Default user-agent: allow public, disallow private
  sections.push(`# ReeeeecallStudy robots.txt
User-agent: *
${buildAllowRules(PUBLIC_PATHS)}
${buildDisallowRules(PRIVATE_PATHS)}`)

  // Bingbot with crawl-delay
  sections.push(`User-agent: Bingbot
Crawl-delay: 2
${buildAllowRules(PUBLIC_PATHS)}
${buildDisallowRules(PRIVATE_PATHS)}`)

  // AI bots: allow public paths only, disallow everything else
  for (const bot of AI_BOTS) {
    sections.push(buildAiBotBlock(bot))
  }

  // Sitemap and LLM context
  sections.push(`Sitemap: ${SITE_URL}/sitemap.xml

# AI/LLM context files
# https://llmstxt.org/
# llms.txt: ${SITE_URL}/llms.txt
# llms-full.txt: ${SITE_URL}/llms-full.txt`)

  const robotsTxt = sections.join('\n\n')

  return new Response(robotsTxt, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
