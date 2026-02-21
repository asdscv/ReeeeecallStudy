// Content generation pipeline orchestrator

import { LOCALES, PIPELINE_DEFAULTS } from './config.js'
import { createLogger, info, warn, error } from './logger.js'
import { selectTopic } from './topic-registry.js'
import { buildPrompt } from './prompt-builder.js'
import { callAI, generateImage } from './ai-client.js'
import { validateArticle, enrichCtaUrls } from './content-schema.js'
import { createSupabaseClient } from './supabase-client.js'
import { checkDuplicate, appendDateSuffix } from './dedup.js'

function generateRunId() {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export async function runContentPipeline(env, cron) {
  const runId = generateRunId()
  createLogger(runId)
  info('Pipeline started', { cron })

  const db = createSupabaseClient(env)

  try {
    // 1. Fetch recent content for dedup and topic selection
    const recentContent = await db.getRecentContent(PIPELINE_DEFAULTS.recentContentLimit)
    info('Fetched recent content', { count: recentContent.length })

    // 2. Extract recently used subtopic IDs from tags
    const recentTags = recentContent.flatMap((c) => c.tags || [])
    const usedSubtopicIds = [...new Set(recentTags)]

    const topicCount = PIPELINE_DEFAULTS.topicsPerRun
    const maxTopics = topicCount + PIPELINE_DEFAULTS.maxExtraTopics
    info('Generating topics', { count: topicCount, maxTopics })

    // Track per-locale success counts
    const successCount = {}
    for (const locale of LOCALES) successCount[locale] = 0

    let topicsAttempted = 0

    while (topicsAttempted < maxTopics) {
      // Stop if all locales met the target
      const allMet = LOCALES.every((l) => successCount[l] >= topicCount)
      if (allMet) break

      // After main batch, only continue if there's a shortfall
      if (topicsAttempted >= topicCount) {
        const anyShort = LOCALES.some((l) => successCount[l] < topicCount)
        if (!anyShort) break
        info('Extra topic attempt to fill shortfall', { topicsAttempted, successCount })
      }

      topicsAttempted++

      try {
        // 3. Select topic (exclude already-picked ones this run)
        const topic = selectTopic(usedSubtopicIds)
        usedSubtopicIds.push(topic.id)
        info('Topic selected', { index: topicsAttempted, category: topic.category, subtopic: topic.id })

        // 4. Generate thumbnail image (shared across locales)
        let thumbnailUrl = null
        try {
          const imagePrompt = buildImagePrompt(topic)
          const tempImageUrl = await generateImage(env, imagePrompt)

          const imageRes = await fetch(tempImageUrl)
          if (imageRes.ok) {
            const imageBuffer = await imageRes.arrayBuffer()
            const imagePath = `${topic.id}-${Date.now()}`
            thumbnailUrl = await db.uploadImage(imagePath, imageBuffer, 'image/jpeg')
          }
        } catch (err) {
          warn('Image generation failed, continuing without image', { error: err.message })
        }

        // 5. Generate en first (need slug for other locales)
        let sharedSlug = null
        try {
          const enArticle = await generateForLocale(env, db, topic, 'en', recentContent, null, thumbnailUrl)
          if (enArticle) {
            sharedSlug = enArticle.slug
            successCount.en++
            info('Locale completed', { locale: 'en', slug: enArticle.slug })
          }
        } catch (err) {
          error('Locale failed', { locale: 'en', error: err.message })
        }

        // 6. Generate ko, zh, ja in parallel
        const otherLocales = LOCALES.filter((l) => l !== 'en')
        const results = await Promise.allSettled(
          otherLocales.map((locale) =>
            generateForLocale(env, db, topic, locale, recentContent, sharedSlug, thumbnailUrl),
          ),
        )

        results.forEach((result, i) => {
          const locale = otherLocales[i]
          if (result.status === 'fulfilled' && result.value) {
            successCount[locale]++
            info('Locale completed', { locale, slug: result.value.slug })
          } else {
            const reason = result.status === 'rejected' ? result.reason?.message : 'no result returned'
            error('Locale failed', { locale, error: reason })
          }
        })
      } catch (err) {
        error('Topic failed', { index: topicsAttempted, error: err.message })
      }
    }

    info('Pipeline completed', { topicsAttempted, successCount, target: topicCount })
  } catch (err) {
    error('Pipeline failed', { error: err.message, stack: err.stack })
  }
}

function buildImagePrompt(topic) {
  return `A modern, clean editorial illustration for a blog article about "${topic.titleHint}" in the context of ${topic.category}. Abstract, minimal style with soft gradients and geometric shapes. No text, no letters, no words. Professional, educational tone. Vibrant but not overwhelming colors.`
}

async function generateForLocale(env, db, topic, locale, recentContent, sharedSlug, thumbnailUrl) {
  info('Generating content', { locale, topic: topic.id })

  const prompt = buildPrompt(topic, locale)
  let article = null

  // Retry generation up to maxValidationRetries times
  for (let attempt = 0; attempt < PIPELINE_DEFAULTS.maxValidationRetries; attempt++) {
    const raw = await callAI(env, prompt.system, prompt.user)

    // Use shared slug from en if available (for ko locale)
    if (sharedSlug && locale !== 'en') {
      raw.slug = sharedSlug
    }

    const validation = validateArticle(raw)
    if (validation.valid) {
      // Inject enterprise UTM parameters into CTA block URLs
      enrichCtaUrls(raw, locale)
      article = raw
      break
    }

    warn('Validation failed, regenerating', { attempt: attempt + 1, errors: validation.errors })
  }

  if (!article) {
    throw new Error(`Failed to generate valid content after ${PIPELINE_DEFAULTS.maxValidationRetries} attempts`)
  }

  // Deduplication check
  let dupCheck = checkDuplicate(
    { slug: article.slug, title: article.title, tags: article.tags, locale },
    recentContent,
  )

  if (dupCheck.isDuplicate) {
    info('Duplicate detected, adding date suffix', { reason: dupCheck.reason })
    article.slug = appendDateSuffix(article.slug)
  }

  // Build DB record
  const SITE_URL = 'https://reeeeecallstudy.xyz'
  const record = {
    title: article.title,
    subtitle: article.subtitle || null,
    slug: article.slug,
    locale,
    content_blocks: article.content_blocks,
    tags: article.tags,
    meta_title: article.meta_title,
    meta_description: article.meta_description,
    reading_time_minutes: article.reading_time_minutes || 5,
    thumbnail_url: thumbnailUrl || null,
    og_image_url: thumbnailUrl || null,
    canonical_url: `${SITE_URL}/insight/${article.slug}`,
    author_name: 'ReeeeecallStudy',
    is_published: true,
    published_at: new Date().toISOString(),
  }

  const inserted = await db.insertContent(record)
  return inserted
}
