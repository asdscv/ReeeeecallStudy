import type { AIProviderConfig } from './types'
import { openaiProvider } from './providers/openai'
import { xaiProvider } from './providers/xai'

const providers: AIProviderConfig[] = [openaiProvider, xaiProvider]

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
