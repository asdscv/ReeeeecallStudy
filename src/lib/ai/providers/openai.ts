import type { AIProviderConfig } from '../types'

export const openaiProvider: AIProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  models: [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
  ],
}
