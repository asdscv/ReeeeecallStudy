// Configuration constants and environment variable helpers

export const LOCALES = ['en', 'ko', 'zh', 'ja', 'vi', 'th', 'id']

export const PIPELINE_DEFAULTS = {
  topicsPerRun: 5,
  maxExtraTopics: 3,
  maxBlocks: 13,
  minBlocks: 7,
  maxRetries: 3,
  recentContentLimit: 100,
  maxValidationRetries: 3,
  topicGenerationCount: 8,
}

export const RETRY_DELAYS = [1000, 3000, 8000]

export function getXaiConfig(env) {
  return {
    apiKey: env.XAI_API_KEY || '',
    baseUrl: env.XAI_BASE_URL || 'https://api.x.ai/v1',
    model: env.XAI_MODEL || 'grok-3-mini',
  }
}

export function getSupabaseConfig(env) {
  return {
    url: env.SUPABASE_URL || 'https://ixdapelfikaneexnskfm.supabase.co',
    serviceKey: env.SUPABASE_SERVICE_KEY || '',
    anonKey: env.SUPABASE_ANON_KEY || '',
  }
}
