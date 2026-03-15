import type { AIProviderConfig } from './types'
import { openaiProvider } from './providers/openai'
import { xaiProvider } from './providers/xai'
import { googleProvider } from './providers/google'
import { anthropicProvider } from './providers/anthropic'

const providers: AIProviderConfig[] = [
  openaiProvider,
  googleProvider,
  anthropicProvider,
  xaiProvider,
]

export function getProviders(): AIProviderConfig[] {
  return providers
}

export function getProvider(id: string): AIProviderConfig | undefined {
  return providers.find((p) => p.id === id)
}

export function getCustomProvider(baseUrl: string): AIProviderConfig {
  return {
    id: 'custom',
    name: 'Custom',
    baseUrl,
    models: [{ id: 'custom', name: 'Custom Model' }],
  }
}
