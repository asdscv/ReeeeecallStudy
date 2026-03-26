import type { AIRequestOptions, AIResponse } from '../types'

// Longer delays: xAI/OpenAI rate limits are often per-minute
const RETRY_DELAYS = [2000, 10000, 30000]
const MAX_ATTEMPTS = RETRY_DELAYS.length

function stripMarkdownFences(text: string): string {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  return cleaned.trim()
}

/** Parse Retry-After header (seconds or HTTP-date) → ms, capped at 60s */
function parseRetryAfter(res: Response): number | null {
  const header = res.headers.get('retry-after')
  if (!header) return null
  const secs = Number(header)
  if (!Number.isNaN(secs)) return Math.min(secs * 1000, 60_000)
  const date = Date.parse(header)
  if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), 60_000)
  return null
}

export async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  options: AIRequestOptions,
): Promise<AIResponse> {
  const body = {
    model,
    messages: [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: options.temperature ?? 0.8,
    max_tokens: options.maxTokens ?? 16384,
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (res.status === 401 || res.status === 403) {
        throw new Error('INVALID_API_KEY')
      }

      if (res.status === 429) {
        if (attempt < MAX_ATTEMPTS - 1) {
          const wait = parseRetryAfter(res) ?? RETRY_DELAYS[attempt]
          await sleep(wait)
          continue
        }
        throw new Error('RATE_LIMITED')
      }

      if (res.status >= 500) {
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(RETRY_DELAYS[attempt])
          continue
        }
        throw new Error('SERVER_ERROR')
      }

      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(`AI API error ${res.status}: ${errBody}`)
      }

      const data = await res.json() as Record<string, any>
      const content = data.choices?.[0]?.message?.content
      if (!content) throw new Error('EMPTY_RESPONSE')

      const cleaned = stripMarkdownFences(content)

      // Validate it's parseable JSON
      JSON.parse(cleaned)

      return {
        content: cleaned,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
            }
          : undefined,
      }
    } catch (err) {
      lastError = err as Error
      const msg = (err as Error).message
      // Don't retry 4xx errors (except 429)
      if (msg === 'INVALID_API_KEY' || msg.includes('AI API error 4')) {
        throw err
      }
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(RETRY_DELAYS[attempt])
      }
    }
  }

  throw lastError ?? new Error('AI call failed')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
