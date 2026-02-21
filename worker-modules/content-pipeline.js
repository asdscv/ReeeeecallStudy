// Content generation pipeline orchestrator

import { LOCALES, PIPELINE_DEFAULTS } from './config.js'
import { createLogger, info, warn, error } from './logger.js'
import { generateTopics } from './topic-generator.js'
import { selectTopic } from './topic-registry.js'
import { buildPrompt } from './prompt-builder.js'
import { callAI, generateImage } from './ai-client.js'
import { validateArticle, enrichCtaUrls } from './content-schema.js'
import { createSupabaseClient } from './supabase-client.js'
import { checkDuplicate, checkSameRunDuplicate, appendDateSuffix } from './dedup.js'

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

    const topicCount = PIPELINE_DEFAULTS.topicsPerRun

    // Track per-locale success counts
    const successCount = {}
    for (const locale of LOCALES) successCount[locale] = 0

    // Run-level state for same-run dedup and title diversity
    const runState = {
      slugs: new Set(),
      titles: [],
      enTitles: [],
    }

    // 2. Generate topics via AI (replaces static topic selection)
    let topics
    try {
      topics = await generateTopics(env, recentContent, PIPELINE_DEFAULTS.topicGenerationCount)
      info('AI topics generated', { count: topics.length })
    } catch (err) {
      warn('Topic generation failed, using static fallback', { error: err.message })
      const recentTags = recentContent.flatMap(c => c.tags || [])
      const usedSubtopicIds = [...new Set(recentTags)]
      topics = []
      for (let i = 0; i < topicCount; i++) {
        topics.push(selectTopic([...usedSubtopicIds, ...topics.map(t => t.id)]))
      }
    }

    let topicsAttempted = 0

    // Iterate over pre-generated topics
    for (const topic of topics) {
      const allMet = LOCALES.every(l => successCount[l] >= topicCount)
      if (allMet) break

      topicsAttempted++

      try {
        info('Topic selected', { index: topicsAttempted, category: topic.category, subtopic: topic.id || topic.titleHint })

        // 3. Generate thumbnail image (shared across locales)
        let thumbnailUrl = null
        try {
          const imagePrompt = buildImagePrompt(topic)
          const tempImageUrl = await generateImage(env, imagePrompt)

          const imageRes = await fetch(tempImageUrl)
          if (imageRes.ok) {
            const imageBuffer = await imageRes.arrayBuffer()
            const imagePath = `${topic.id || 'topic'}-${Date.now()}`
            thumbnailUrl = await db.uploadImage(imagePath, imageBuffer, 'image/jpeg')
          }
        } catch (err) {
          warn('Image generation failed, continuing without image', { error: err.message })
        }

        // 4. Generate EN first (need slug + title for other locales and run tracking)
        let sharedSlug = null
        try {
          const enArticle = await generateForLocale(
            env, db, topic, 'en', recentContent, null, thumbnailUrl, runState,
          )
          if (enArticle) {
            sharedSlug = enArticle.slug
            successCount.en++

            runState.slugs.add(`${enArticle.slug}__en`)
            runState.titles.push({ title: enArticle.title, locale: 'en' })
            runState.enTitles.push(enArticle.title)

            info('Locale completed', { locale: 'en', slug: enArticle.slug })
          }
        } catch (err) {
          error('Locale failed', { locale: 'en', error: err.message })
        }

        // 5. Generate ko, zh, ja in parallel
        const otherLocales = LOCALES.filter(l => l !== 'en')
        const results = await Promise.allSettled(
          otherLocales.map(locale =>
            generateForLocale(env, db, topic, locale, recentContent, sharedSlug, thumbnailUrl, runState),
          ),
        )

        results.forEach((result, i) => {
          const locale = otherLocales[i]
          if (result.status === 'fulfilled' && result.value) {
            successCount[locale]++
            runState.slugs.add(`${result.value.slug}__${locale}`)
            runState.titles.push({ title: result.value.title, locale })
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

async function generateForLocale(env, db, topic, locale, recentContent, sharedSlug, thumbnailUrl, runState) {
  info('Generating content', { locale, topic: topic.id || topic.titleHint })

  const prompt = buildPrompt(topic, locale, {
    previousTitles: runState.enTitles || [],
  })
  let article = null

  // Retry generation up to maxValidationRetries times
  for (let attempt = 0; attempt < PIPELINE_DEFAULTS.maxValidationRetries; attempt++) {
    const raw = await callAI(env, prompt.system, prompt.user)

    // Use shared slug from en if available (for non-en locales)
    if (sharedSlug && locale !== 'en') {
      raw.slug = sharedSlug
    }

    const validation = validateArticle(raw)
    if (validation.valid) {
      enrichCtaUrls(raw, locale)
      article = raw
      break
    }

    warn('Validation failed, regenerating', { attempt: attempt + 1, errors: validation.errors })
  }

  if (!article) {
    throw new Error(`Failed to generate valid content after ${PIPELINE_DEFAULTS.maxValidationRetries} attempts`)
  }

  // Same-run dedup check
  const sameRunCheck = checkSameRunDuplicate(
    { slug: article.slug, title: article.title, tags: article.tags, locale },
    runState,
  )
  if (sameRunCheck.isDuplicate) {
    info('Same-run duplicate detected, adding date suffix', { reason: sameRunCheck.reason })
    article.slug = appendDateSuffix(article.slug)
  }

  // DB-level dedup check
  const dupCheck = checkDuplicate(
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
