import type { AIConfig, AIRequestOptions, AIResponse } from './types'
import { getProvider, getCustomProvider } from './provider-registry'
import { callOpenAICompatible } from './providers/base-openai'
import { callAnthropic } from './providers/anthropic-caller'

async function callProvider(
  config: AIConfig,
  options: AIRequestOptions,
): Promise<AIResponse> {
  // Anthropic Claude uses its own API format
  if (config.providerId === 'anthropic') {
    return callAnthropic(config.apiKey, config.model, options)
  }

  // All others use OpenAI-compatible API
  const provider =
    config.providerId === 'custom' && config.baseUrl
      ? getCustomProvider(config.baseUrl)
      : getProvider(config.providerId)

  if (!provider) throw new Error('UNKNOWN_PROVIDER')

  const baseUrl = config.baseUrl || provider.baseUrl

  return callOpenAICompatible(baseUrl, config.apiKey, config.model, options)
}

export async function callAI(
  config: AIConfig,
  options: AIRequestOptions,
): Promise<Record<string, unknown>> {
  const response = await callProvider(config, options)

  try {
    return JSON.parse(response.content) as Record<string, unknown>
  } catch {
    // If JSON parse failed, retry with stricter prompt
    const retryResponse = await callProvider(config, {
      ...options,
      systemPrompt:
        options.systemPrompt +
        '\n\nIMPORTANT: You MUST respond with valid JSON only. No markdown, no explanation, just pure JSON.',
    })
    return JSON.parse(retryResponse.content) as Record<string, unknown>
  }
}
