import { Aperture, LayoutGrid, Repeat, Copy, Hash, Eye, Droplet, PlusCircle, TrendingUp, type LucideIcon } from 'lucide-react'
import type { BrainColor, CellTone } from '@reeeeecall/shared/lib/brain-games'
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

/** Ink colours for the colour-word game — saturated enough to read on light and dark. */
export const INK: Record<BrainColor, string> = {
  red: '#dc2626',
  blue: '#2563eb',
  green: '#15803d',
  yellow: '#b45309',
  purple: '#9333ea',
  orange: '#ea580c',
}

/**
 * Cell tones. A lit cell carries a ring as well as a colour (WCAG 1.4.11: state must not be
 * colour alone), and the "missed" answer a dashed ring.
 */
export const TONE_CLASS: Record<CellTone, string> = {
  idle: 'bg-muted hover:bg-accent text-foreground',
  lit: 'bg-brand text-brand-foreground ring-4 ring-inset ring-white/70',
  correct: 'bg-success text-success-foreground',
  wrong: 'bg-destructive text-destructive-foreground',
  missed: 'bg-brand/15 outline-dashed outline-[3px] outline-offset-[-6px] outline-brand-active text-foreground',
  faceDown: 'bg-brand hover:bg-brand-hover text-white',
  faceUp: 'bg-brand/10 border-2 border-brand/40 text-foreground',
  matched: 'bg-success/10 border-2 border-success/50 text-foreground opacity-60',
  done: 'bg-muted/40 text-muted-foreground',
}

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
  }
}

/**
 * The web's platform context. Quick Eye starts at 33ms (two 60Hz frames) — a browser's frame
 * timing is not trustworthy enough at one frame without hardware checks — and keeps the inner ring
 * to the 8 radial positions on small screens, where 16 stimuli would overlap the centre box.
 */
export function webPlatform(boardWidth: number, maxCols: number): PlatformContext {
  const small = Math.min(window.innerWidth, window.innerHeight) < 600 || boardWidth < 600
  return { maxCols, minExposureMs: 33, ringSlots: small ? [8, 16, 16] : [16, 16, 16] }
}
