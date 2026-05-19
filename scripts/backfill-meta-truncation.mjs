#!/usr/bin/env node
/**
 * Backfill script: re-apply word-boundary truncation to existing
 * `contents.meta_title` and `contents.meta_description` rows in Supabase.
 *
 * Pre-fix code used a naive `.slice()` and cut mid-word (e.g.
 * "TOEFL Skimming Techniques for Academic Pas | ReeeeecallStudy").
 * `truncateAtWordBoundary()` in worker-modules/content-schema.js now
 * snaps to the last space (when within 75% of budget). This script
 * walks every published row, recomputes the canonical meta values
 * and either prints a diff (default DRY RUN) or PATCHes the row
 * (APPLY=1 + SUPABASE_SERVICE_KEY).
 *
 *   DRY RUN:
 *     node scripts/backfill-meta-truncation.mjs
 *
 *   APPLY:
 *     APPLY=1 SUPABASE_SERVICE_KEY=... node scripts/backfill-meta-truncation.mjs
 *
 * Reads anon key from env (SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY)
 * for the read pass.  The script is idempotent — a second run produces
 * zero diffs.
 */

import { truncateAtWordBoundary } from '../worker-modules/content-schema.js'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ixdapelfikaneexnskfm.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const APPLY = process.env.APPLY === '1'

const BRAND_SUFFIX = ' | ReeeeecallStudy'
const META_TITLE_MAX = 60
const META_DESC_MAX = 155
const META_DESC_BUDGET = 152 // = 155 - '...'.length

if (!ANON_KEY) {
  console.error('error: SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY) is required for reads')
  process.exit(1)
}

if (APPLY && !SERVICE_KEY) {
  console.error('error: APPLY=1 requires SUPABASE_SERVICE_KEY env var')
  process.exit(1)
}

// Re-derive what content-schema.js would produce for a fresh article.
// `meta_title` always ends with BRAND_SUFFIX.  If the suffix is missing
// from the stored value (e.g. AI omitted it and pre-fix code never
// re-added it), we append it before measuring.
function canonicalMetaTitle(stored) {
  if (typeof stored !== 'string') return stored
  let mt = stored
  if (!mt.endsWith(BRAND_SUFFIX)) mt = mt + BRAND_SUFFIX
  if (mt.length > META_TITLE_MAX) {
    mt = truncateAtWordBoundary(mt, META_TITLE_MAX - BRAND_SUFFIX.length) + BRAND_SUFFIX
  }
  return mt
}

function canonicalMetaDescription(stored) {
  if (typeof stored !== 'string') return stored
  if (stored.length <= META_DESC_MAX) return stored
  return truncateAtWordBoundary(stored, META_DESC_BUDGET) + '...'
}

const CJK_LOCALES = new Set(['ko', 'zh', 'ja', 'th'])

async function fetchAllRows() {
  const pageSize = 1000
  const all = []
  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/contents`)
    url.searchParams.set('is_published', 'eq.true')
    url.searchParams.set('select', 'slug,locale,title,meta_title,meta_description')
    url.searchParams.set('order', 'slug.asc,locale.asc')
    const res = await fetch(url, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        Range: `${offset}-${offset + pageSize - 1}`,
        'Range-Unit': 'items',
      },
    })
    if (!res.ok && res.status !== 206) {
      throw new Error(`fetch failed: HTTP ${res.status} ${await res.text()}`)
    }
    const batch = await res.json()
    all.push(...batch)
    if (batch.length < pageSize) break
  }
  return all
}

async function patchRow(slug, locale, patch) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/contents`)
  url.searchParams.set('slug', `eq.${slug}`)
  url.searchParams.set('locale', `eq.${locale}`)
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    throw new Error(`PATCH ${slug}/${locale} failed: HTTP ${res.status} ${await res.text()}`)
  }
}

function diffLine(slug, locale, field, oldVal, newVal) {
  return JSON.stringify({ slug, locale, field, old: oldVal, new: newVal })
}

async function main() {
  console.error(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`)
  console.error(`fetching published rows from ${SUPABASE_URL} ...`)

  const rows = await fetchAllRows()
  console.error(`scanned: ${rows.length} rows`)

  let titleAffected = 0
  let descAffected = 0
  const byLocale = {} // locale -> { title: n, desc: n }
  const byScript = { latin: { title: 0, desc: 0 }, cjk: { title: 0, desc: 0 } }

  for (const row of rows) {
    const { slug, locale, meta_title, meta_description } = row
    const newMt = canonicalMetaTitle(meta_title)
    const newMd = canonicalMetaDescription(meta_description)

    const patch = {}
    if (newMt !== meta_title) {
      patch.meta_title = newMt
      titleAffected++
      byLocale[locale] = byLocale[locale] || { title: 0, desc: 0 }
      byLocale[locale].title++
      const bucket = CJK_LOCALES.has(locale) ? 'cjk' : 'latin'
      byScript[bucket].title++
      console.log(diffLine(slug, locale, 'meta_title', meta_title, newMt))
    }
    if (newMd !== meta_description) {
      patch.meta_description = newMd
      descAffected++
      byLocale[locale] = byLocale[locale] || { title: 0, desc: 0 }
      byLocale[locale].desc++
      const bucket = CJK_LOCALES.has(locale) ? 'cjk' : 'latin'
      byScript[bucket].desc++
      console.log(diffLine(slug, locale, 'meta_description', meta_description, newMd))
    }

    if (APPLY && Object.keys(patch).length > 0) {
      await patchRow(slug, locale, patch)
    }
  }

  const affectedRows =
    rows.filter((r) =>
      r.meta_title !== canonicalMetaTitle(r.meta_title) ||
      r.meta_description !== canonicalMetaDescription(r.meta_description),
    ).length

  console.error('---')
  console.error(`affected: ${affectedRows} (meta_title=${titleAffected}, meta_description=${descAffected})`)
  console.error('by locale:')
  for (const loc of Object.keys(byLocale).sort()) {
    const b = byLocale[loc]
    console.error(`  ${loc}: meta_title=${b.title}, meta_description=${b.desc}`)
  }
  console.error('by script:')
  console.error(`  latin (en/es/vi/id): meta_title=${byScript.latin.title}, meta_description=${byScript.latin.desc}`)
  console.error(`  cjk   (ko/zh/ja/th): meta_title=${byScript.cjk.title}, meta_description=${byScript.cjk.desc}`)
  console.error(`mode was: ${APPLY ? 'APPLY (writes performed)' : 'DRY RUN (no writes)'}`)
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
