// Configuration constants and environment variable helpers

// Locale generation policy lives in locale-policy.js (single source of truth).
// LOCALES = the locales the daily pipeline GENERATES. To change which locales
// are generated, edit locale-policy.js — not this file.
import { GENERATED_LOCALES, DEFAULT_LOCALE as POLICY_DEFAULT_LOCALE } from './locale-policy.js'

export const LOCALES = GENERATED_LOCALES
export const DEFAULT_LOCALE = POLICY_DEFAULT_LOCALE

// One article a day, on purpose: Google rewards a steady stream of pages that each answer
// a real query far more than a flood of generated ones (see DOCS/GROWTH/2026-11-11-web-search-keyword-loop.md).
export const PIPELINE_DEFAULTS = {
  topicsPerRun: 1,
  maxExtraTopics: 3,
  // The deeper model overshoots the prompt's 10-15 by a few blocks; a longer guide is fine, a rejected one is not.
  maxBlocks: 22,
  minBlocks: 7,
  maxRetries: 3,
  recentContentLimit: 100,
  maxValidationRetries: 3,
  topicGenerationCount: 8,
}

// "Impressions but no clicks" in finalized Search Console data. Sized to this site: in
// 2026-11 only 117 of ~3,300 pages had ever shown in Google (208 impressions in 8 months),
// so a single impression is signal and the window is long. Raise both as traffic grows.
export const KEYWORD_PLANNER = {
  windowDays: 180,
  minImpressions: 1,
  maxClicks: 0,
  // Already near the top with zero clicks is a snippet problem, not a missing page.
  minPosition: 8,
  maxCandidates: 25,
  // Writing an off-topic page costs a day's slot and site quality, so require a clear yes.
  minFit: 0.6,
  maxBrand: 0.5,
}

export const RETRY_DELAYS = [1000, 3000, 8000]

export function getXaiConfig(env) {
  return {
    apiKey: env.XAI_API_KEY || '',
    baseUrl: env.XAI_BASE_URL || 'https://api.x.ai/v1',
    model: env.XAI_MODEL || 'grok-4.20-non-reasoning',
  }
}

export function getSupabaseConfig(env) {
  return {
    url: env.SUPABASE_URL || 'https://ixdapelfikaneexnskfm.supabase.co',
    serviceKey: env.SUPABASE_SERVICE_KEY || '',
    anonKey: env.SUPABASE_ANON_KEY || '',
  }
}
