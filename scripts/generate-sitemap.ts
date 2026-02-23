/**
 * Build-time script to generate sitemap.xml
 * Run: npx tsx scripts/generate-sitemap.ts
 *
 * Fetches all published content slugs from Supabase and generates
 * a complete sitemap.xml in the public/ directory.
 */
import { writeFileSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { generateSitemapXml } from '../src/lib/sitemap'

// Load .env file
const envPath = resolve(import.meta.dirname, '..', '.env')
try {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex)
    const value = trimmed.slice(eqIndex + 1)
    if (!process.env[key]) process.env[key] = value
  }
} catch { /* .env not found, rely on existing env */ }

const SITE_URL = 'https://reeeeecallstudy.xyz'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function main() {
  const staticPages = [
    { loc: SITE_URL, changefreq: 'weekly' as const, priority: 1.0 },
    { loc: `${SITE_URL}/insight`, changefreq: 'daily' as const, priority: 0.9 },
  ]

  // Fetch all published content slugs
  const { data, error } = await supabase
    .from('contents')
    .select('slug, updated_at')
    .eq('is_published', true)
    .eq('locale', 'en') // Use en as primary for sitemap (hreflang handles ko)

  if (error) {
    console.error('Failed to fetch contents:', error.message)
    process.exit(1)
  }

  const contentPages = (data ?? []).map((row) => ({
    loc: `${SITE_URL}/insight/${row.slug}`,
    lastmod: row.updated_at,
    changefreq: 'monthly' as const,
    priority: 0.8,
  }))

  // Fetch active marketplace listings for public preview pages
  const { data: listings, error: listingsError } = await supabase
    .from('marketplace_listings')
    .select('id, updated_at')
    .eq('is_active', true)

  if (listingsError) {
    console.warn('Failed to fetch marketplace listings:', listingsError.message)
  }

  const listingPages = (listings ?? []).map((row) => ({
    loc: `${SITE_URL}/d/${row.id}`,
    lastmod: row.updated_at,
    changefreq: 'weekly' as const,
    priority: 0.7,
  }))

  const xml = generateSitemapXml(staticPages, contentPages, listingPages)
  const outPath = resolve(import.meta.dirname, '..', 'public', 'sitemap.xml')
  writeFileSync(outPath, xml, 'utf-8')

  console.log(`Sitemap generated: ${outPath} (${staticPages.length + contentPages.length + listingPages.length} URLs)`)
}

main()
