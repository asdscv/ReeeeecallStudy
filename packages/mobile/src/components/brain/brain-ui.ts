import type { BrainColor, CellTone } from '@reeeeecall/shared/lib/brain-games'
import type { BrainStorage } from '@reeeeecall/shared/stores/brain-store'
import { palette, type Theme } from '../../theme'
import { localPrefs } from '../../utils/local-prefs'

/** Same ink colours as web, so the colour-word game reads the same on every platform. */
export const INK: Record<BrainColor, string> = {
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#16a34a',
  yellow: '#d4a106',
  purple: '#a855f7',
  orange: '#f97316',
}

export interface ToneStyle {
  bg: string
  fg: string
  border?: string
  opacity?: number
}

export function toneStyle(tone: CellTone, theme: Theme): ToneStyle {
  const c = theme.colors
  switch (tone) {
    case 'lit':
      return { bg: c.primary, fg: '#fff' }
    case 'correct':
      return { bg: c.success, fg: '#fff' }
    case 'wrong':
      return { bg: c.error, fg: '#fff' }
    case 'missed':
      return { bg: c.primaryLight, fg: c.text, border: c.primary }
    case 'faceDown':
      return { bg: theme.isDark ? palette.blue[500] : palette.blue[400], fg: '#fff' }
    case 'faceUp':
      return { bg: c.primaryLight, fg: c.text, border: theme.isDark ? palette.blue[700] : palette.blue[200] }
    case 'matched':
      return { bg: c.successLight, fg: c.text, border: c.success, opacity: 0.6 }
    case 'done':
      return { bg: c.surface, fg: c.textTertiary, opacity: 0.45 }
    case 'idle':
    default:
      return { bg: c.surface, fg: c.text }
  }
}

export function brainStorageFor(userId: string): BrainStorage {
  return {
    key: `brain-progress.${userId}`,
    load: () => localPrefs.getBrainProgress(userId),
    save: (raw) => localPrefs.setBrainProgress(userId, raw),
  }
}
