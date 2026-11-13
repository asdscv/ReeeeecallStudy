import { Aperture, Compass, LayoutGrid, Layers, Lock, Repeat, Copy, Hash, Eye, Droplet, PlusCircle, Target, TrendingUp, type LucideIcon } from 'lucide-react'
import { INK_COLORS, maxRowsFor, type CellInk } from '@reeeeecall/shared/lib/brain-games'
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
  // The thinking games (2026-11-13): Set Match, Code Break, Make the Number, Maze Run.
  layers: Layers,
  lock: Lock,
  target: Target,
  compass: Compass,
}

/** Ink colours for the colour-word game (shared with the app). */
export const INK = INK_COLORS

/**
 * A grid label's ink on the dark canvas (Odd One Out's colour noise, Number Hunt's second series):
 * told apart by brightness and hue, never red against green. Even on the light end of a game
 * canvas each is ≥ 4:1 (labels are ≥ 28px bold, where 3:1 is the bar); colour is never the only cue
 * that matters — the second series is also boxed.
 */
export const CELL_INK: Record<CellInk, string> = {
  neutral: '#F8FAFC',
  amber: '#FBBF24',
  cyan: '#67E8F9',
}

/**
 * The height a grid board may take in a round: the window less the round's header, score row,
 * bars, prompt and verdict line (≈330px), never below 360. BrainBoard sizes its cells from it.
 */
export function boardHeight(): number {
  return Math.max(360, (typeof window === 'undefined' ? 768 : window.innerHeight) - 330)
}

/** The row above a grid (badge, chip, waves, budget) with its margin: kept out of the cells' height. */
export const BOARD_STRIP_H = 44

export function brainStorageFor(userId: string): BrainStorage {
  const key = `reeeeecall-brain:${userId}`
  return {
    key,
    userId,
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
    loadMeta: () => {
      try {
        return localStorage.getItem(`${key}:meta`)
      } catch {
        return null
      }
    },
    saveMeta: (raw) => {
      try {
        localStorage.setItem(`${key}:meta`, raw)
      } catch {
        // Same as progress.
      }
    },
  }
}

/** The account was deleted: its brain record leaves this browser too (the server row goes with the account). */
export function forgetBrainOnDevice(userId: string) {
  const key = `reeeeecall-brain:${userId}`
  for (const k of [key, `${key}:history`, `${key}:meta`]) {
    try {
      localStorage.removeItem(k)
    } catch {
      // Blocked storage: nothing was kept there either.
    }
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
 * The web's platform context.
 *
 * `maxRows`: the tallest grid that keeps 56px cells in the board's height, less the strip a tall
 * board carries above it (Flash Grid's «N칸» and waves) — so a portrait 5×7 board is only offered
 * where it fits without scrolling.
 */
export function webPlatform(_boardWidth: number, maxCols: number, maxRows = maxRowsFor(boardHeight() - BOARD_STRIP_H)): PlatformContext & { maxRows: number } {
  return { maxCols, maxRows }
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
