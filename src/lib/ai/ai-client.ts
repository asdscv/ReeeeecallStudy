import type { AIConfig, AIRequestOptions } from './types'
import { getProvider, getCustomProvider } from './provider-registry'
import { callOpenAICompatible } from './providers/base-openai'

export async function callAI(
  config: AIConfig,
  options: AIRequestOptions,
): Promise<Record<string, unknown>> {
  const provider =
    config.providerId === 'custom' && config.baseUrl
      ? getCustomProvider(config.baseUrl)
      : getProvider(config.providerId)

  if (!provider) throw new Error('UNKNOWN_PROVIDER')

  const baseUrl = config.baseUrl || provider.baseUrl

  const response = await callOpenAICompatible(
    baseUrl,
    config.apiKey,
    config.model,
    options,
  )

  try {
    return JSON.parse(response.content) as Record<string, unknown>
  } catch {
    // If JSON parse failed on the cleaned content, try one more time with stricter prompt
    const retryResponse = await callOpenAICompatible(baseUrl, config.apiKey, config.model, {
      ...options,
      systemPrompt:
        options.systemPrompt +
        '\n\nIMPORTANT: You MUST respond with valid JSON only. No markdown, no explanation, just pure JSON.',
    })
    return JSON.parse(retryResponse.content) as Record<string, unknown>
  }
}
