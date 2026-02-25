import { describe, it, expect } from 'vitest'
import { PIPELINE_DEFAULTS, LOCALES } from '../config.js'

describe('PIPELINE_DEFAULTS', () => {
  it('topicsPerRun is 5', () => {
    expect(PIPELINE_DEFAULTS.topicsPerRun).toBe(5)
  })

  it('topicGenerationCount is 8', () => {
    expect(PIPELINE_DEFAULTS.topicGenerationCount).toBe(8)
  })

  it('maxExtraTopics is 3', () => {
    expect(PIPELINE_DEFAULTS.maxExtraTopics).toBe(3)
  })

  it('retains other defaults unchanged', () => {
    expect(PIPELINE_DEFAULTS.maxBlocks).toBe(13)
    expect(PIPELINE_DEFAULTS.minBlocks).toBe(7)
    expect(PIPELINE_DEFAULTS.maxRetries).toBe(3)
    expect(PIPELINE_DEFAULTS.recentContentLimit).toBe(100)
    expect(PIPELINE_DEFAULTS.maxValidationRetries).toBe(3)
  })
})

describe('LOCALES', () => {
  it('supports all 7 languages', () => {
    expect(LOCALES).toEqual(['en', 'ko', 'zh', 'ja', 'vi', 'th', 'id'])
  })
})
