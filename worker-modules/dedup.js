// Deduplication checks: slug, title similarity (Jaccard), tag overlap

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\uac00-\ud7af\u4e00-\u9fff\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf]/g, '')
    .split(/\s+/)
    .filter(Boolean)
}

function jaccardSimilarity(a, b) {
  const setA = new Set(tokenize(a))
  const setB = new Set(tokenize(b))
  if (setA.size === 0 && setB.size === 0) return 1

  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }

  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

function tagOverlap(tagsA, tagsB) {
  const setA = new Set(tagsA)
  let overlap = 0
  for (const tag of tagsB) {
    if (setA.has(tag)) overlap++
  }
  return overlap
}

export function checkDuplicate(article, recentContent) {
  // 1. Exact slug match
  const slugMatch = recentContent.find(
    (c) => c.slug === article.slug && c.locale === article.locale,
  )
  if (slugMatch) {
    return { isDuplicate: true, reason: 'slug_exact_match', matchId: slugMatch.id }
  }

  // 2. Title similarity (Jaccard > 0.6)
  for (const c of recentContent) {
    if (c.locale !== article.locale) continue
    const sim = jaccardSimilarity(article.title, c.title)
    if (sim > 0.6) {
      return { isDuplicate: true, reason: 'title_similar', similarity: sim, matchId: c.id }
    }
  }

  // 3. Tag overlap with recent 5 articles in same locale
  const sameLocale = recentContent.filter((c) => c.locale === article.locale).slice(0, 5)
  for (const c of sameLocale) {
    if (!c.tags || !article.tags) continue
    const overlap = tagOverlap(article.tags, c.tags)
    if (overlap >= 3 && overlap >= article.tags.length * 0.8) {
      return { isDuplicate: true, reason: 'tag_overlap', overlap, matchId: c.id }
    }
  }

  return { isDuplicate: false }
}

/**
 * Check if an article duplicates another article generated in the SAME pipeline run.
 * Catches cases where the AI generates similar content for different topics.
 *
 * @param {object} article - { slug, title, tags, locale }
 * @param {object} runState - { slugs: Set<string>, titles: Array<{title, locale}> }
 * @returns {{ isDuplicate: boolean, reason?: string, similarity?: number }}
 */
export function checkSameRunDuplicate(article, runState) {
  if (!runState) return { isDuplicate: false }

  // 1. Exact slug collision within this run
  const slugKey = `${article.slug}__${article.locale}`
  if (runState.slugs.has(slugKey)) {
    return { isDuplicate: true, reason: 'same_run_slug_collision' }
  }

  // 2. Title similarity against same-run articles (same locale only)
  const sameLocaleTitles = (runState.titles || []).filter(
    t => t.locale === article.locale,
  )
  for (const t of sameLocaleTitles) {
    const sim = jaccardSimilarity(article.title, t.title)
    if (sim > 0.5) {
      return { isDuplicate: true, reason: 'same_run_title_similar', similarity: sim }
    }
  }

  return { isDuplicate: false }
}

export function appendDateSuffix(slug) {
  const d = new Date()
  const suffix = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `${slug}-${suffix}`
}
