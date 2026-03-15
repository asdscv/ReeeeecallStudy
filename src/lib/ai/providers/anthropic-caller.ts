import type { AIRequestOptions, AIResponse } from '../types'

const RETRY_DELAYS = [1000, 3000, 8000]

function stripMarkdownFences(text: string): string {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  return cleaned.trim()
}

export async function callAnthropic(
  apiKey: string,
  model: string,
  options: AIRequestOptions,
): Promise<AIResponse> {
  const body = {
    model,
    max_tokens: options.maxTokens ?? 4096,
    system: options.systemPrompt,
    messages: [
      { role: 'user', content: options.userPrompt },
    ],
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      })

      if (res.status === 401 || res.status === 403) {
        throw new Error('INVALID_API_KEY')
      }

      if (res.status === 429) {
        if (attempt < RETRY_DELAYS.length - 1) {
          await sleep(RETRY_DELAYS[attempt])
          continue
        }
        throw new Error('RATE_LIMITED')
      }

      if (res.status >= 500) {
        if (attempt < RETRY_DELAYS.length - 1) {
          await sleep(RETRY_DELAYS[attempt])
          continue
        }
        throw new Error('SERVER_ERROR')
      }

      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(`AI API error ${res.status}: ${errBody}`)
      }

      const data = await res.json()
      const textBlock = data.content?.find(
        (b: { type: string }) => b.type === 'text',
      )
      const content = textBlock?.text
      if (!content) throw new Error('EMPTY_RESPONSE')

      const cleaned = stripMarkdownFences(content)

      // Validate JSON
      JSON.parse(cleaned)

      return {
        content: cleaned,
        usage: data.usage
          ? {
              promptTokens: data.usage.input_tokens,
              completionTokens: data.usage.output_tokens,
            }
          : undefined,
      }
    } catch (err) {
      lastError = err as Error
      const msg = (err as Error).message
      if (msg === 'INVALID_API_KEY' || msg.includes('AI API error 4')) {
        throw err
      }
      if (attempt < RETRY_DELAYS.length - 1) {
        await sleep(RETRY_DELAYS[attempt])
      }
    }
  }

  throw lastError ?? new Error('AI call failed')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
