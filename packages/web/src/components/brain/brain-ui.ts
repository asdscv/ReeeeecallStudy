import { LayoutGrid, Repeat, Copy, Hash, Eye, Droplet, PlusCircle, TrendingUp, type LucideIcon } from 'lucide-react'
import type { BrainColor, CellTone } from '@reeeeecall/shared/lib/brain-games'
import type { BrainStorage } from '@reeeeecall/shared/stores/brain-store'

/** The catalog names icons; web draws them with lucide (mobile uses the same names in Feather). */
export const BRAIN_ICONS: Record<string, LucideIcon> = {
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
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#16a34a',
  yellow: '#d4a106',
  purple: '#a855f7',
  orange: '#f97316',
}

export const TONE_CLASS: Record<CellTone, string> = {
  idle: 'bg-muted hover:bg-accent text-foreground',
  lit: 'bg-brand text-white scale-[1.03]',
  correct: 'bg-success text-white',
  wrong: 'bg-destructive text-white',
  missed: 'bg-brand/25 ring-2 ring-brand text-foreground',
  faceDown: 'bg-brand/85 hover:bg-brand text-white',
  faceUp: 'bg-brand/10 border-2 border-brand/30 text-foreground',
  matched: 'bg-success/15 border-2 border-success/40 text-foreground opacity-60',
  done: 'bg-muted/40 text-content-tertiary',
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
