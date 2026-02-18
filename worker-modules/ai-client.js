// Grok (xAI) API client with retry, rate-limit handling, and JSON parsing

import { getXaiConfig, RETRY_DELAYS } from './config.js'
import { info, warn, error } from './logger.js'

function stripMarkdownFences(text) {
  let cleaned = text.trim()
  // Remove ```json ... ``` or ``` ... ```
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  return cleaned.trim()
}

export async function callAI(env, systemPrompt, userPrompt) {
  const config = getXaiConfig(env)

  if (!config.apiKey) {
    throw new Error('XAI_API_KEY not configured')
  }

  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.8,
    max_tokens: 4096,
  }

  let lastError = null

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    try {
      info('AI request', { attempt: attempt + 1, model: config.model })

      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10)
        const delay = Math.max(retryAfter * 1000, RETRY_DELAYS[attempt])
        warn('Rate limited, retrying', { retryAfter, delay })
        await sleep(delay)
        continue
      }

      if (res.status >= 500) {
        const errBody = await res.text()
        warn('Server error, retrying', { status: res.status, body: errBody })
        await sleep(RETRY_DELAYS[attempt])
        continue
      }

      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(`AI API error ${res.status}: ${errBody}`)
      }

      const data = await res.json()
      const content = data.choices?.[0]?.message?.content

      if (!content) {
        throw new Error('AI returned empty content')
      }

      const cleaned = stripMarkdownFences(content)
      const parsed = JSON.parse(cleaned)

      info('AI response parsed', { title: parsed.title, blockCount: parsed.content_blocks?.length })
      return parsed
    } catch (err) {
      lastError = err
      if (attempt < RETRY_DELAYS.length - 1 && !err.message.includes('AI API error 4')) {
        warn('AI call failed, retrying', { attempt: attempt + 1, error: err.message })
        await sleep(RETRY_DELAYS[attempt])
      }
    }
  }

  error('AI call failed after all retries', { error: lastError?.message })
  throw lastError
}

export async function generateImage(env, prompt) {
  const config = getXaiConfig(env)

  if (!config.apiKey) {
    throw new Error('XAI_API_KEY not configured')
  }

  const imageModel = env.XAI_IMAGE_MODEL || 'grok-imagine-image'

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    try {
      info('Image generation request', { attempt: attempt + 1, model: imageModel })

      const res = await fetch(`${config.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: imageModel,
          prompt,
          n: 1,
          response_format: 'url',
          aspect_ratio: '16:9',
        }),
      })

      if (res.status === 429) {
        const delay = RETRY_DELAYS[attempt]
        warn('Image rate limited, retrying', { delay })
        await sleep(delay)
        continue
      }

      if (res.status >= 500) {
        warn('Image server error, retrying', { status: res.status })
        await sleep(RETRY_DELAYS[attempt])
        continue
      }

      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(`Image API error ${res.status}: ${errBody}`)
      }

      const data = await res.json()
      const imageUrl = data.data?.[0]?.url

      if (!imageUrl) {
        throw new Error('Image API returned no URL')
      }

      info('Image generated', { url: imageUrl })
      return imageUrl
    } catch (err) {
      if (attempt < RETRY_DELAYS.length - 1) {
        warn('Image generation failed, retrying', { attempt: attempt + 1, error: err.message })
        await sleep(RETRY_DELAYS[attempt])
      } else {
        error('Image generation failed after all retries', { error: err.message })
        throw err
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
