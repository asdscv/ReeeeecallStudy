/**
 * Add Spanish (es_meaning, es_example) columns to vocabulary CSV files.
 * Uses Claude API to translate English words/examples into Spanish.
 *
 * Run:
 *   ANTHROPIC_API_KEY=sk-xxx npx tsx scripts/add-spanish-to-csv.ts
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import Papa from 'papaparse'
import Anthropic from '@anthropic-ai/sdk'

const DATA_DIR = resolve(import.meta.dirname, '..', 'data')

const CSV_FILES = [
  'english-beginner-1000.csv',
  'toeic-600-1000.csv',
  'toeic-700-1300.csv',
  'toeic-800-1500.csv',
  'toeic-900-1500.csv',
  'toeic-990-1500.csv',
]

const BATCH_SIZE = 50

interface Row {
  english: string
  example: string
  ko_meaning: string
  ko_example: string
  ja_meaning: string
  ja_example: string
  zh_meaning: string
  zh_example: string
  es_meaning?: string
  es_example?: string
}

interface TranslationItem {
  es_meaning: string
  es_example: string
}

const client = new Anthropic()

async function translateBatch(
  rows: Row[],
): Promise<TranslationItem[]> {
  const items = rows.map((r, i) => ({
    i,
    english: r.english,
    example: r.example,
  }))

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: `Translate each English vocabulary word and its example sentence into Spanish.

Return a JSON array with exactly ${items.length} objects in the same order.
Each object must have: "es_meaning" (Spanish meaning of the word) and "es_example" (Spanish translation of the example sentence).

Keep translations natural and concise. For es_meaning, provide a brief definition or equivalent word(s) in Spanish.

Words to translate:
${JSON.stringify(items, null, 2)}

Respond ONLY with the JSON array, no markdown fences or extra text.`,
      },
    ],
  })

  const text =
    response.content[0].type === 'text' ? response.content[0].text : ''

  // Strip possible markdown code fences
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '')

  const parsed: TranslationItem[] = JSON.parse(cleaned)

  if (parsed.length !== rows.length) {
    throw new Error(
      `Expected ${rows.length} translations, got ${parsed.length}`,
    )
  }

  return parsed
}

async function processFile(filename: string) {
  const filepath = resolve(DATA_DIR, filename)
  const raw = readFileSync(filepath, 'utf-8')

  const { data, meta } = Papa.parse<Row>(raw, {
    header: true,
    skipEmptyLines: true,
  })

  // Skip if already has Spanish columns
  if (meta.fields?.includes('es_meaning')) {
    console.log(`⏭ ${filename}: already has es_meaning — skipping`)
    return
  }

  console.log(`📝 ${filename}: ${data.length} rows`)

  const totalBatches = Math.ceil(data.length / BATCH_SIZE)

  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const batch = data.slice(i, i + BATCH_SIZE)

    let translations: TranslationItem[] | null = null
    let retries = 0
    const maxRetries = 3

    while (!translations && retries < maxRetries) {
      try {
        translations = await translateBatch(batch)
      } catch (err) {
        retries++
        if (retries >= maxRetries) throw err
        console.warn(
          `  ⚠ Batch ${batchNum} failed (attempt ${retries}/${maxRetries}), retrying in 5s...`,
        )
        await new Promise((r) => setTimeout(r, 5000))
      }
    }

    for (let j = 0; j < batch.length; j++) {
      data[i + j].es_meaning = translations![j].es_meaning
      data[i + j].es_example = translations![j].es_example
    }

    console.log(`  ✓ Batch ${batchNum}/${totalBatches} (rows ${i + 1}–${Math.min(i + BATCH_SIZE, data.length)})`)

    // Rate limit: short pause between batches
    if (i + BATCH_SIZE < data.length) {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  // Write back with correct column order
  const columns = [
    'english',
    'example',
    'ko_meaning',
    'ko_example',
    'ja_meaning',
    'ja_example',
    'zh_meaning',
    'zh_example',
    'es_meaning',
    'es_example',
  ]

  const csv = Papa.unparse(data, { columns })
  writeFileSync(filepath, csv + '\n', 'utf-8')

  console.log(`✅ ${filename}: done (${data.length} rows written)\n`)
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required')
    process.exit(1)
  }

  console.log('=== Adding Spanish columns to CSV files ===\n')

  for (const file of CSV_FILES) {
    await processFile(file)
  }

  console.log('=== All files processed ===')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
