import { Aperture, LayoutGrid, Repeat, Copy, Hash, Eye, Droplet, PlusCircle, TrendingUp, type LucideIcon } from 'lucide-react'
import { INK_COLORS } from '@reeeeecall/shared/lib/brain-games'
import type { BrainStorage } from '@reeeeecall/shared/stores/brain-store'
import type { PlatformContext } from '@reeeeecall/shared/hooks/useBrainRound'

/** The catalog names icons; web draws them with lucide (mobile uses the same names in Feather). */
export const BRAIN_ICONS: Record<string, LucideIcon> = {
  aperture: Aperture,
  grid: LayoutGrid,
  repeat: Repeat,
  copy: Copy,
  hash: Hash,
  eye: Eye,
  droplet: Droplet,
  'plus-circle': PlusCircle,
  'trending-up': TrendingUp,
}

/** Ink colours for the colour-word game (shared with the app). */
export const INK = INK_COLORS

export function brainStorageFor(userId: string): BrainStorage {
  const key = `reeeeecall-brain:${userId}`
  return {
    key,
    load: () => {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    save: (raw) => {
      try {
        localStorage.setItem(key, raw)
      } catch {
        // Private mode or full storage: the session still plays, progress just is not kept.
      }
    },
    loadHistory: () => {
      try {
        return localStorage.getItem(`${key}:history`)
      } catch {
        return null
      }
    },
    saveHistory: (raw) => {
      try {
        localStorage.setItem(`${key}:history`, raw)
      } catch {
        // Same as progress.
      }
    },
  }
}

/** The game screen's background: the game's deep gradient. */
export function canvasBackground(theme: { canvasFrom: string; canvasTo: string }): string {
  return `radial-gradient(120% 80% at 50% 0%, ${theme.canvasTo} 0%, ${theme.canvasFrom} 70%)`
}

export function cardBackground(theme: { cardFrom: string; cardTo: string }): string {
  return `linear-gradient(135deg, ${theme.cardFrom} 0%, ${theme.cardTo} 100%)`
}

/**
 * The web's platform context. Quick Eye starts at 33ms (two 60Hz frames) — a browser's frame
 * timing is not trustworthy enough at one frame without hardware checks — and keeps the inner ring
 * to the 8 radial positions on small screens, where 16 stimuli would overlap the centre box.
 */
export function webPlatform(_boardWidth: number, maxCols: number): PlatformContext {
  // Decided by the screen, as the app does (its screenShortSide) — not by the board, which is
  // capped at 560px and would always read as "small".
  const small = Math.min(window.innerWidth, window.innerHeight) < 600
  return { maxCols, minExposureMs: 33, ringSlots: small ? [8, 16, 16] : [16, 16, 16] }
}

/**
 * Whether the player is driving with the keyboard. Screens move focus to their main button only
 * then — on a touch screen, focus moved by script draws a ring the player never asked for.
 */
let keyboardMode = false
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === ' ') keyboardMode = true }, true)
  window.addEventListener('pointerdown', () => { keyboardMode = false }, true)
}

export function focusIfKeyboard(el: HTMLElement | null | undefined) {
  if (keyboardMode) el?.focus({ preventScroll: true })
}
