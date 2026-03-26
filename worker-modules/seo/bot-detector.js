export const BOT_UA = new RegExp([
  // Search engines
  'googlebot', 'google-inspectiontool', 'storebot-google',
  'bingbot', 'msnbot',
  'yandex', 'yandexbot',
  'baiduspider', 'baidu',
  'duckduckbot',
  'slurp',                    // Yahoo
  'naverbot', 'yeti',         // Naver
  'daum',                     // Daum/Kakao
  'sogou',
  'seznam',
  'applebot',
  'petalbot',                 // Huawei
  'qwantify',
  // Social media / link preview bots
  'twitterbot',
  'facebookexternalhit', 'facebookcatalog',
  'linkedinbot',
  'slackbot',
  'whatsapp',
  'telegrambot',
  'discordbot',
  'pinterestbot',
  'redditbot',
  'skypeuripreview',
  'kakaotalk-scrap',
  'line-poker',               // LINE
  // AI answer engines (AEO)
  'chatgpt-user',
  'gptbot',
  'oai-searchbot',
  'perplexitybot',
  'claudebot', 'claude-web',
  'google-extended',
  'cohere-ai',
  'bytespider',               // TikTok/ByteDance
  'amazonbot',
  'anthropic-ai',
  'meta-externalagent',
  'iaskspider',               // iAsk.Ai
  'youbot',                   // You.com
  // SEO tools
  'semrushbot', 'ahrefsbot', 'mj12bot', 'dotbot',
  'screaming frog',
  // Generic
  'crawler', 'spider', 'ia_archiver',
  'headlesschrome', 'phantomjs', 'prerender',
].join('|'), 'i')

export function isBot(ua) {
  return BOT_UA.test(ua || '')
}
