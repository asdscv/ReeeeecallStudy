import type { AIProviderConfig } from '../types'

export const googleProvider: AIProviderConfig = {
  id: 'google',
  name: 'Google Gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  models: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
  ],
}
