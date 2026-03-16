import type { AIProviderConfig } from '../types'

export const xaiProvider: AIProviderConfig = {
  id: 'xai',
  name: 'xAI (Grok)',
  baseUrl: 'https://api.x.ai/v1',
  models: [
    { id: 'grok-3-mini', name: 'Grok 3 Mini' },
    { id: 'grok-3', name: 'Grok 3' },
  ],
}
