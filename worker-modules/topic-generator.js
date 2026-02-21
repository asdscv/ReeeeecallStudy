// AI-powered dynamic topic generation with static registry fallback

import { callAI } from './ai-client.js'
import { selectTopic } from './topic-registry.js'
import { info, warn } from './logger.js'

const TOPIC_GENERATION_SYSTEM_PROMPT = `You are a topic planner for an educational blog about learning, studying, and knowledge retention.

Generate diverse topic ideas covering ALL domains of study and learning -- not just learning science. Include:
- STEM subjects (physics, chemistry, biology, mathematics, computer science, engineering)
- Humanities (history, philosophy, literature, linguistics, anthropology)
- Social sciences (psychology, sociology, economics, political science)
- Arts & creative (music theory, art history, design, creative writing)
- Professional fields (law, medicine, business, accounting, nursing)
- Languages (English, Korean, Japanese, Chinese, Spanish, etc.)
- Test preparation (SAT, GRE, TOEFL, IELTS, MCAT, bar exam, CPA, etc.)
- Study techniques & productivity (note-taking, time management, focus, memory)
- Technology & digital learning (AI-assisted study, coding bootcamps, online courses)
- Health & wellness for students (sleep, exercise, stress management, nutrition)

## Output Format
Return a JSON object:
{
  "topics": [
    {
      "category": "Domain name (e.g., 'Physics', 'Art History', 'Study Productivity')",
      "titleHint": "Specific angle (e.g., 'Understanding Quantum Entanglement Through Flashcards')",
      "keywords": ["keyword1", "keyword2", "keyword3"],
      "tags": ["tag1", "tag2", "tag3"],
      "audience": "Target audience description"
    }
  ]
}

## Rules
- Each topic must have a UNIQUE, specific angle -- not generic overviews
- Vary the domains widely: no more than 2 topics from the same category
- Every topic must have a natural connection to studying, learning, or knowledge retention
- titleHint should suggest a specific, interesting angle, NOT a generic title
- Include 3-5 keywords per topic (for SEO, these guide the article writer)
- Include 3 tags per topic (lowercase, hyphenated)
- audience should be specific (not just "students")`

export async function generateTopics(env, recentContent, count = 12) {
  try {
    const recentTitles = recentContent
      .slice(0, 100)
      .filter(c => c.locale === 'en' || !c.locale)
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
