// AI-powered dynamic topic generation with static registry fallback

import { callAI } from './ai-client.js'
import { selectTopic } from './topic-registry.js'
import { DEFAULT_LOCALE } from './config.js'
import { info, warn } from './logger.js'

const TOPIC_GENERATION_SYSTEM_PROMPT = `You are a topic planner for an educational blog targeting REAL STUDENTS and TEST TAKERS — people actively preparing for exams, learning languages, or studying for professional certifications.

## CRITICAL RULE: Every topic MUST be directly useful to someone who is studying for a specific exam, learning a language, or preparing for a professional certification. Do NOT generate generic academic theory, philosophy, art criticism, or abstract topics that no student would search for.

Generate topic ideas from these categories (follow the distribution):

### PRIORITY 1 — At least 50% of topics (4+ out of 8):
- **English proficiency exams**: TOEIC (Part 5 grammar, listening tips, score strategies), TOEFL (writing, speaking, reading), IELTS (band score tips, speaking parts, writing task 2)
- **English vocabulary & grammar**: word roots, phrasal verbs, collocations, business English, common mistakes, academic vocabulary
- **Other language exams**: JLPT (N5-N1), HSK, TOPIK, DELE — kanji tips, vocabulary strategies, grammar patterns
- **College entrance exams**: 수능 (국어/영어/수학), SAT, ACT — subject-specific strategies and study plans

### PRIORITY 2 — Up to 30% of topics (2-3 out of 8):
- **Graduate exams**: GRE verbal/quant, GMAT, LSAT, MCAT
- **Professional certifications**: CPA, CFA, AWS, PMP, bar exam, NCLEX
- **Medical/science study**: anatomy memorization, pharmacology, biology, chemistry

### PRIORITY 3 — At most 1-2 topics:
- **Study methods**: Only if tied to a SPECIFIC exam or subject (e.g., "How to use flashcards for TOEIC vocabulary" not "The science of memory")
- **Exam anxiety & planning**: Study schedules, test-day strategies

### NEVER generate topics about:
- Philosophy, anthropology, art history, creative writing, music theory
- Generic "learning science" without exam/study context
- Technology trends, AI, coding bootcamps (unless for a specific cert like AWS)
- Health & wellness (sleep tips, nutrition, exercise)
- Abstract productivity advice not tied to exam prep

## Output Format
Return a JSON object:
{
  "topics": [
    {
      "category": "Specific category (e.g., 'TOEIC Preparation', 'JLPT Study', 'SAT Math')",
      "titleHint": "Specific angle (e.g., 'TOEIC Part 5: 10 Grammar Patterns That Always Appear')",
      "keywords": ["keyword1", "keyword2", "keyword3"],
      "tags": ["tag1", "tag2", "tag3"],
      "audience": "Target audience description"
    }
  ]
}

## Rules
- Each topic must target someone who would search for it while studying for an exam or learning a language
- titleHint should be specific enough that a student would click on it (e.g., "IELTS Speaking Part 2: How to Structure Your Answer" not "Improving Your Speaking Skills")
- Include 3-5 keywords per topic that real students would search on Google/Naver/YouTube
- Include 3 tags per topic (lowercase, hyphenated)
- audience should name the specific exam or language (not just "students")`

export async function generateTopics(env, recentContent, count = 12) {
  try {
    const recentTitles = recentContent
      .slice(0, 100)
      .filter(c => c.locale === DEFAULT_LOCALE || !c.locale)
      .map(c => c.title)
      .slice(0, 50)

    const recentTags = [...new Set(recentContent.flatMap(c => c.tags || []))]

    const userPrompt = `Generate exactly ${count} diverse topic ideas for our next batch of articles.

${recentTitles.length > 0 ? `## Recently Published Topics (AVOID similar topics)\n${recentTitles.map(t => `- ${t}`).join('\n')}` : ''}

${recentTags.length > 0 ? `## Recently Used Tags (diversify away from these)\n${recentTags.slice(0, 30).join(', ')}` : ''}

Generate ${count} fresh, diverse topics that are DIFFERENT from the above.`

    const result = await callAI(env, TOPIC_GENERATION_SYSTEM_PROMPT, userPrompt)

    if (!result.topics || !Array.isArray(result.topics)) {
      warn('AI topic generation returned invalid format, falling back to static registry')
      return fallbackTopics(recentContent, count)
    }

    const validTopics = result.topics
      .filter(t => t.category && t.titleHint && Array.isArray(t.keywords) && Array.isArray(t.tags))
      .map(t => ({
        id: slugify(t.titleHint),
        category: t.category,
        titleHint: t.titleHint,
        keywords: t.keywords.slice(0, 5),
        tags: t.tags.slice(0, 5).map(tag => tag.toLowerCase().replace(/\s+/g, '-')),
        audience: t.audience || 'students and lifelong learners',
      }))

    if (validTopics.length < count * 0.5) {
      warn('Too few valid AI topics, supplementing with static registry', {
        aiTopics: validTopics.length,
        needed: count,
      })
      const staticFill = fallbackTopics(recentContent, count - validTopics.length)
      return [...validTopics, ...staticFill]
    }

    info('AI topic generation succeeded', { count: validTopics.length })
    return validTopics.slice(0, count)
  } catch (err) {
    warn('AI topic generation failed, falling back to static registry', { error: err.message })
    return fallbackTopics(recentContent, count)
  }
}

function fallbackTopics(recentContent, count) {
  const recentTags = recentContent.flatMap(c => c.tags || [])
  const usedIds = [...new Set(recentTags)]
  const topics = []

  for (let i = 0; i < count; i++) {
    const topic = selectTopic([...usedIds, ...topics.map(t => t.id)])
    topics.push(topic)
  }

  return topics
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
}
