import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateTopics, slugify } from '../topic-generator.js'

// Mock ai-client
vi.mock('../ai-client.js', () => ({
  callAI: vi.fn(),
}))

// Mock topic-registry
vi.mock('../topic-registry.js', () => ({
  selectTopic: vi.fn((usedIds) => ({
    id: `static-topic-${usedIds.length}`,
    category: 'Learning Science',
    titleHint: `Static Topic ${usedIds.length}`,
    keywords: ['keyword1'],
    tags: ['tag1'],
    audience: 'students',
  })),
}))

// Mock logger
vi.mock('../logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

import { callAI } from '../ai-client.js'
import { selectTopic } from '../topic-registry.js'

function makeAIResponse(count) {
  return {
    topics: Array.from({ length: count }, (_, i) => ({
      category: `Category ${i}`,
      titleHint: `Unique Topic Angle ${i}: Something Specific`,
      keywords: ['kw1', 'kw2', 'kw3'],
      tags: ['tag-one', 'tag-two', 'tag-three'],
      audience: `Audience group ${i}`,
    })),
  }
}

describe('generateTopics', () => {
  const env = { XAI_API_KEY: 'test-key' }
  const recentContent = [
    { title: 'Old Article', locale: 'en', tags: ['old-tag'] },
    { title: '한국어 기사', locale: 'ko', tags: ['korean-tag'] },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns correct count when AI succeeds', async () => {
    callAI.mockResolvedValue(makeAIResponse(14))

    const topics = await generateTopics(env, recentContent, 12)

    expect(topics).toHaveLength(12)
    expect(callAI).toHaveBeenCalledOnce()
  })

  it('returns topics with correct structure', async () => {
    callAI.mockResolvedValue(makeAIResponse(5))

    const topics = await generateTopics(env, recentContent, 5)

    for (const topic of topics) {
      expect(topic).toHaveProperty('id')
      expect(topic).toHaveProperty('category')
      expect(topic).toHaveProperty('titleHint')
      expect(topic).toHaveProperty('keywords')
      expect(topic).toHaveProperty('tags')
      expect(topic).toHaveProperty('audience')
      expect(typeof topic.id).toBe('string')
      expect(Array.isArray(topic.keywords)).toBe(true)
      expect(Array.isArray(topic.tags)).toBe(true)
    }
  })

  it('normalizes tags to lowercase hyphenated', async () => {
    callAI.mockResolvedValue({
      topics: [
        {
          category: 'Test',
          titleHint: 'Test Topic',
          keywords: ['kw'],
          tags: ['Mixed Case', 'UPPER CASE', 'already-good'],
          audience: 'testers',
        },
      ],
    })

    const topics = await generateTopics(env, recentContent, 1)

    expect(topics[0].tags).toEqual(['mixed-case', 'upper-case', 'already-good'])
  })

  it('caps keywords at 5 and tags at 5', async () => {
    callAI.mockResolvedValue({
      topics: [
        {
          category: 'Test',
          titleHint: 'Test Topic',
          keywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
          tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
          audience: 'testers',
        },
      ],
    })

    const topics = await generateTopics(env, recentContent, 1)

    expect(topics[0].keywords).toHaveLength(5)
    expect(topics[0].tags).toHaveLength(5)
  })

  it('falls back to static registry when AI call fails', async () => {
    callAI.mockRejectedValue(new Error('Network error'))

    const topics = await generateTopics(env, recentContent, 3)

    expect(topics).toHaveLength(3)
    expect(selectTopic).toHaveBeenCalled()
    expect(topics[0].id).toMatch(/^static-topic-/)
  })

  it('falls back to static registry when AI returns invalid format', async () => {
    callAI.mockResolvedValue({ invalid: 'response' })

    const topics = await generateTopics(env, recentContent, 3)

    expect(topics).toHaveLength(3)
    expect(selectTopic).toHaveBeenCalled()
  })

  it('supplements with static when AI returns too few valid topics', async () => {
    // Return 2 valid + 3 invalid (missing required fields)
    callAI.mockResolvedValue({
      topics: [
        { category: 'A', titleHint: 'Valid 1', keywords: ['k'], tags: ['t'], audience: 'a' },
        { category: 'B', titleHint: 'Valid 2', keywords: ['k'], tags: ['t'], audience: 'a' },
        { category: null, titleHint: null, keywords: null, tags: null },
        { category: 'C' }, // missing titleHint
        {}, // empty
      ],
    })

    const topics = await generateTopics(env, recentContent, 10)

    // 2 AI + 8 static = 10 total
    expect(topics.length).toBe(10)
    expect(selectTopic).toHaveBeenCalled()
  })

  it('filters only EN titles for avoidance context', async () => {
    const mixedContent = [
      { title: 'English Title', locale: 'en', tags: [] },
      { title: '한국어 제목', locale: 'ko', tags: [] },
      { title: 'Another EN', locale: 'en', tags: [] },
      { title: 'No locale', tags: [] },
    ]

    callAI.mockResolvedValue(makeAIResponse(5))
    await generateTopics(env, mixedContent, 5)

    const userPrompt = callAI.mock.calls[0][2]
    expect(userPrompt).toContain('English Title')
    expect(userPrompt).toContain('Another EN')
    expect(userPrompt).toContain('No locale')
    expect(userPrompt).not.toContain('한국어 제목')
  })

  it('includes recent tags in avoidance context', async () => {
    const contentWithTags = [
      { title: 'A', locale: 'en', tags: ['spaced-repetition', 'memory'] },
      { title: 'B', locale: 'en', tags: ['flashcards', 'memory'] },
    ]

    callAI.mockResolvedValue(makeAIResponse(3))
    await generateTopics(env, contentWithTags, 3)

    const userPrompt = callAI.mock.calls[0][2]
    expect(userPrompt).toContain('spaced-repetition')
    expect(userPrompt).toContain('flashcards')
  })

  it('handles empty recentContent gracefully', async () => {
    callAI.mockResolvedValue(makeAIResponse(3))

    const topics = await generateTopics(env, [], 3)

    expect(topics).toHaveLength(3)
  })

  it('defaults audience when AI omits it', async () => {
    callAI.mockResolvedValue({
      topics: [
        { category: 'Test', titleHint: 'Topic', keywords: ['k'], tags: ['t'] },
      ],
    })

    const topics = await generateTopics(env, [], 1)

    expect(topics[0].audience).toBe('students and lifelong learners')
  })
})

describe('slugify', () => {
  it('converts to lowercase kebab-case', () => {
    expect(slugify('Hello World Test')).toBe('hello-world-test')
  })

  it('removes special characters', () => {
    expect(slugify("What's the Best Way?")).toBe('whats-the-best-way')
  })

  it('collapses multiple dashes', () => {
    expect(slugify('Hello --- World')).toBe('hello-world')
  })

  it('truncates to 60 characters', () => {
    const long = 'a '.repeat(100)
    expect(slugify(long).length).toBeLessThanOrEqual(60)
  })

  it('handles empty string', () => {
    expect(slugify('')).toBe('')
  })

  it('handles string with only special characters', () => {
    expect(slugify('!@#$%^&*()')).toBe('')
  })
})
