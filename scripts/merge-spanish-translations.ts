/**
 * Merge Spanish translation JSONL files into CSV files.
 * Run after generating translations:
 *   npx tsx scripts/merge-spanish-translations.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import Papa from 'papaparse'

const DATA_DIR = resolve(import.meta.dirname, '..', 'data')
const TRANSLATIONS_DIR = '/tmp/es_translations'

const CSV_FILES = [
  'english-beginner-1000.csv',
  'toeic-600-1000.csv',
  'toeic-700-1300.csv',
  'toeic-800-1500.csv',
  'toeic-900-1500.csv',
  'toeic-990-1500.csv',
]

const COLUMNS = [
  'english', 'example',
  'ko_meaning', 'ko_example',
  'ja_meaning', 'ja_example',
  'zh_meaning', 'zh_example',
  'es_meaning', 'es_example',
]

for (const file of CSV_FILES) {
  const csvPath = resolve(DATA_DIR, file)
  const jsonlPath = resolve(TRANSLATIONS_DIR, file.replace('.csv', '.jsonl'))

  if (!existsSync(jsonlPath)) {
    console.log(`⏭ ${file}: no JSONL file found — skipping`)
    continue
  }

  const raw = readFileSync(csvPath, 'utf-8')
  const { data } = Papa.parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: true,
  })

  if (data[0]?.es_meaning) {
    console.log(`⏭ ${file}: already has es_meaning — skipping`)
    continue
  }

  const translations = readFileSync(jsonlPath, 'utf-8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { es_meaning: string; es_example: string })

  if (data.length !== translations.length) {
    console.error(
      `❌ ${file}: row count mismatch — CSV has ${data.length}, JSONL has ${translations.length}`,
    )
    continue
  }

  let emptyCount = 0
  for (let i = 0; i < data.length; i++) {
    data[i].es_meaning = translations[i].es_meaning
    data[i].es_example = translations[i].es_example
    if (!translations[i].es_meaning || !translations[i].es_example) emptyCount++
  }

  if (emptyCount > 0) {
    console.warn(`⚠ ${file}: ${emptyCount} rows with empty translations`)
  }

  const csv = Papa.unparse(data, { columns: COLUMNS })
  writeFileSync(csvPath, csv + '\n', 'utf-8')
  console.log(`✅ ${file}: merged ${data.length} rows`)
}

console.log('\n=== Merge complete ===')
