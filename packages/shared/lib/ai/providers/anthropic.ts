import type { AIProviderConfig } from '../types'

export const anthropicProvider: AIProviderConfig = {
  id: 'anthropic',
  name: 'Anthropic Claude',
  baseUrl: 'https://api.anthropic.com/v1',
  models: [
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
  ],
}
