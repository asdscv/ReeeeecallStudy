/**
 * @deprecated Use `aiConfigManager` from `./secure-storage` instead.
 * This module is kept only for backward compatibility and will be removed.
 */
import type { AIConfig } from './types'
import { aiConfigManager } from './secure-storage'

const LEGACY_KEY = 'reeeeecall-ai-config'

/** @deprecated Use `aiConfigManager.load(uid)` instead. */
export function loadAIConfig(): AIConfig | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AIConfig
  } catch {
    return null
  }
}

/** @deprecated Use `aiConfigManager.save(uid, config)` instead. */
export function saveAIConfig(config: AIConfig): void {
  try {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(config))
  } catch {
    // private browsing — silently fail
  }
}

/** @deprecated Use `aiConfigManager.clear()` instead. */
export function clearAIConfig(): void {
  aiConfigManager.clear()
}
