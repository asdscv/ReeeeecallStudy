import type { AIConfig } from './types'

const STORAGE_KEY = 'reeeeecall-ai-config'

export function loadAIConfig(): AIConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AIConfig
  } catch {
    return null
  }
}

export function saveAIConfig(config: AIConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // private browsing — silently fail
  }
}

export function clearAIConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // private browsing
  }
}
