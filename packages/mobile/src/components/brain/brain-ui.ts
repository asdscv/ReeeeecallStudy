import type { Feather } from '@expo/vector-icons'
import { maxColsFor, type BrainColor, type CellTone } from '@reeeeecall/shared/lib/brain-games'
import type { PlatformContext } from '@reeeeecall/shared/hooks/useBrainRound'
import type { BrainStorage } from '@reeeeecall/shared/stores/brain-store'
import { palette, type Theme } from '../../theme'
import { localPrefs } from '../../utils/local-prefs'

export type FeatherName = React.ComponentProps<typeof Feather>['name']

/** Same ink colours as web, so the colour-word game reads the same on every platform. */
export const INK: Record<BrainColor, string> = {
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#16a34a',
  yellow: '#d4a106',
  purple: '#a855f7',
  orange: '#f97316',
}

/**
 * A second cue besides colour, for players who cannot tell the tones apart. A colour-blind player
 * otherwise sees "a blue cell" and "a grey cell" at the same brightness — the memorise phase of
 * Flash Grid would be unplayable.
 */
export type ToneMark = 'dot' | 'check' | 'cross'

export interface ToneStyle {
  bg: string
  fg: string
  border?: string
  borderWidth?: number
  borderStyle?: 'solid' | 'dashed'
  opacity?: number
  mark?: ToneMark
}

export function toneStyle(tone: CellTone, theme: Theme): ToneStyle {
  const c = theme.colors
  // `textInverse` is white on the light theme and near-black on the dark one, where primary,
  // success and error are the lighter 400 shades — white on those fails contrast.
  switch (tone) {
    case 'lit':
      // Primary against the idle surface: blue-600 on gray-100 ≈ 4.7:1, blue-400 on gray-800 ≈ 5.7:1.
      return { bg: c.primary, fg: c.textInverse, mark: 'dot' }
    case 'correct':
      return { bg: c.success, fg: c.textInverse, mark: 'check' }
    case 'wrong':
      return { bg: c.error, fg: c.textInverse, mark: 'cross' }
    case 'missed':
      // The cell that should have been tapped: outlined, dashed — readable without its colour.
      return { bg: c.primaryLight, fg: c.text, border: c.primary, borderWidth: 3, borderStyle: 'dashed' }
    case 'faceDown':
      return { bg: theme.isDark ? palette.blue[500] : palette.blue[400], fg: '#fff' }
    case 'faceUp':
      return { bg: c.primaryLight, fg: c.text, border: theme.isDark ? palette.blue[700] : palette.blue[200], borderWidth: 2 }
    case 'matched':
      return { bg: c.successLight, fg: c.text, border: c.success, borderWidth: 2, opacity: 0.6 }
    case 'done':
      return { bg: c.surface, fg: c.textTertiary, opacity: 0.45 }
    case 'idle':
    default:
      return { bg: c.surface, fg: c.text, border: c.border, borderWidth: 1 }
  }
}

export function brainStorageFor(userId: string): BrainStorage {
  return {
    key: `brain-progress.${userId}`,
    load: () => localPrefs.getBrainProgress(userId),
    save: (raw) => localPrefs.setBrainProgress(userId, raw),
  }
}

/**
 * What the engine needs to know about this screen before a round is built.
 *
 * React Native's JS clock is jittery, so Quick Eye starts no shorter than two 60Hz frames (33ms).
 * A phone's inner ring is too short for 16 stimuli without crowding the centre box, so it carries
 * only the eight radial positions; a tablet's is not.
 */
export function mobilePlatform(boardWidth: number, screenShortSide: number): PlatformContext {
  return {
    maxCols: maxColsFor(boardWidth),
    minExposureMs: 33,
    ringSlots: screenShortSide >= 600 ? [16, 16, 16] : [8, 16, 16],
  }
}

/** Widest a board gets on a tablet — past this, cells only grow and the eyes travel further. */
export const MAX_BOARD_WIDTH = 560
