import type { AIProviderConfig } from '../types'

export const xaiProvider: AIProviderConfig = {
  id: 'xai',
  name: 'xAI (Grok)',
  baseUrl: 'https://api.x.ai/v1',
  models: [
    { id: 'grok-4-1-fast-non-reasoning', name: 'Grok 4.1 Fast' },
    { id: 'grok-4-1-fast-reasoning', name: 'Grok 4.1 Fast (Reasoning)' },
    { id: 'grok-4.20-0309-non-reasoning', name: 'Grok 4.20' },
    { id: 'grok-4.20-0309-reasoning', name: 'Grok 4.20 (Reasoning)' },
    { id: 'grok-3-mini', name: 'Grok 3 Mini' },
    { id: 'grok-3', name: 'Grok 3' },
  ],
}
