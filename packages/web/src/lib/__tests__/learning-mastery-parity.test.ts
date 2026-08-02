/**
 * The maturity threshold exists in two languages, so it is pinned in both.
 *
 * `mature_card_count` (migration 183) hard-codes 21 days because SQL cannot import a TypeScript
 * constant, and `LEGACY_MATURE_INTERVAL_DAYS` is the same number in the criterion catalog. A
 * number living in two places with nothing holding them together is precisely how this codebase
 * ended up with two disagreeing definitions of mastery in the first place — the dashboard's
 * `interval >= 21` and the achievement migration's `ease_factor > 2.5`.
 *
 * Source-level because no runtime reaches both: the web bundle never executes the migration.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LEGACY_MATURE_INTERVAL_DAYS } from '@reeeeecall/shared/learning'

const REPO_ROOT = join(__dirname, '../../../../..')
const MIGRATION = 'supabase/migrations/183_one_mastery_definition.sql'

describe('the maturity threshold agrees across SQL and TypeScript', () => {
  it('the helper uses exactly the TypeScript constant', () => {
    const sql = readFileSync(join(REPO_ROOT, MIGRATION), 'utf-8')
    // The predicate inside `mature_card_count`, not the header prose that quotes the old rule.
    const predicate = sql.match(/AND interval_days >= (\d+);/)
    expect(predicate, `${MIGRATION} no longer contains the maturity predicate`).not.toBeNull()
    expect(Number(predicate![1])).toBe(LEGACY_MATURE_INTERVAL_DAYS)
  })

  it('the migration retires the single-correct-answer rule in both callers', () => {
    // `ease_factor > 2.5` may appear only in the comment explaining what was replaced.
    const sql = readFileSync(join(REPO_ROOT, MIGRATION), 'utf-8')
    const code = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n')
    expect(code).not.toContain('ease_factor > 2.5')
    expect(code.match(/mature_card_count\(v_uid\)/g) ?? []).toHaveLength(2)
  })
})
