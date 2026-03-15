import type { AIProviderConfig } from '../types'

export const openaiProvider: AIProviderConfig = {
  id: 'openai',
  name: 'OpenAI / ChatGPT',
  baseUrl: 'https://api.openai.com/v1',
  models: [
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
    { id: 'gpt-4.1', name: 'GPT-4.1' },
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'o4-mini', name: 'o4-mini' },
  ],
}
