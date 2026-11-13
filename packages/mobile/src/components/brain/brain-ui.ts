import { AppState } from 'react-native'
import type { Feather } from '@expo/vector-icons'
import { INK_COLORS, brainGame, maxColsFor, maxRowsFor, type BrainColor, type BrainGameId, type CellInk } from '@reeeeecall/shared/lib/brain-games'
import type { PlatformContext } from '@reeeeecall/shared/hooks/useBrainRound'
import { flushBrainCloud, useBrainStore, type BrainStorage } from '@reeeeecall/shared/stores/brain-store'
import { localPrefs } from '../../utils/local-prefs'

export type FeatherName = React.ComponentProps<typeof Feather>['name']

/** The catalog names its icons in Feather's vocabulary (web maps the same names to lucide). */
export function gameIcon(id: BrainGameId): FeatherName {
  return brainGame(id).icon as FeatherName
}

/**
 * Ink colours for the colour-word game — the same as web. The stimulus sits on a white card on
 * every canvas, so these are the darker shades that keep their contrast against white.
 */
export const INK: Record<BrainColor, string> = INK_COLORS

/**
 * A grid label's ink on the dark canvas (Odd One Out's colour noise, Number Hunt's second series)
 * — the same as web: told apart by brightness and hue, never red against green. Colour is never
 * the only cue that matters: the second series is also boxed.
 */
export const CELL_INK: Record<CellInk, string> = {
  neutral: '#F8FAFC',
  amber: '#FBBF24',
  cyan: '#67E8F9',
}

/** The row above a grid (badge, chip, waves, budget) with its margin: kept out of the cells' height. */
export const BOARD_STRIP_H = 44

/** Text on the white cards and lit tiles of the canvas. */
export const CANVAS_INK = '#0F172A'
/** The colours the canvas uses beyond each game's theme (verdicts, hearts, gold). */
export const FX = {
  heart: '#FB7185',
  gold: '#FDE68A',
  goodText: '#86EFAC',
  badText: '#FCA5A5',
  amber: '#FBBF24',
  red: '#F87171',
  overlay: 'rgba(2,6,23,0.82)',
  glass: 'rgba(255,255,255,0.07)',
  glassBorder: 'rgba(255,255,255,0.10)',
} as const

/**
 * SecureStore writes are synchronous (Keystore encryption and a commit on Android), and a round
 * saves after every judged trial — in the middle of the reveal and its haptic. So writes are
 * coalesced: the store updates in memory at once, the value reaches disk ~400ms after the last
 * change, and anything pending is written straight away when the app leaves the foreground or a
 * brain screen closes (flushBrainStorage) — which then also sends it to the account's cloud copy.
 * Coming back to the foreground re-reads the cloud copy (another device may have played meanwhile).
 */
const SAVE_DELAY_MS = 400
const flushers = new Set<() => void>()
let appStateHooked = false

function deferredWriter(write: (raw: string) => void) {
  let pending: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (pending === null) return
    const raw = pending
    pending = null
    write(raw)
  }
  flushers.add(flush)
  if (!appStateHooked) {
    appStateHooked = true
    AppState.addEventListener('change', (state) => {
      if (state !== 'active') flushBrainStorage()
      else void useBrainStore.getState().syncNow()
    })
  }
  return {
    save(raw: string) {
      pending = raw
      if (!timer) timer = setTimeout(flush, SAVE_DELAY_MS)
    },
    /** What a load would see — the pending value if one has not reached disk yet. */
    pending: () => pending,
    /** Forget anything not yet written, and stop being flushed. */
    drop() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = null
      flushers.delete(flush)
    },
  }
}

/** Write every pending brain save now (a brain screen closing, the app going to the background), then send it to the cloud. */
export function flushBrainStorage() {
  flushers.forEach((flush) => flush())
  void flushBrainCloud()
}

const storages = new Map<string, BrainStorage>()
const writers = new Map<string, ReturnType<typeof deferredWriter>[]>()

/** The account was deleted: drop unsaved writes and its brain record on this device (the server row goes with the account). */
export function forgetBrainOnDevice(userId: string) {
  writers.get(userId)?.forEach((w) => w.drop())
  writers.delete(userId)
  storages.delete(userId)
  localPrefs.clearBrain(userId)
}

export function brainStorageFor(userId: string): BrainStorage {
  const cached = storages.get(userId)
  if (cached) return cached
  const progress = deferredWriter((raw) => localPrefs.setBrainProgress(userId, raw))
  const history = deferredWriter((raw) => localPrefs.setBrainHistory(userId, raw))
  const meta = deferredWriter((raw) => localPrefs.setBrainMeta(userId, raw))
  writers.set(userId, [progress, history, meta])
  const storage: BrainStorage = {
    key: `brain-progress.${userId}`,
    userId,
    load: () => progress.pending() ?? localPrefs.getBrainProgress(userId),
    save: progress.save,
    loadHistory: () => history.pending() ?? localPrefs.getBrainHistory(userId),
    saveHistory: history.save,
    loadMeta: () => meta.pending() ?? localPrefs.getBrainMeta(userId),
    saveMeta: meta.save,
  }
  storages.set(userId, storage)
  return storage
}

/**
 * What the engine needs to know about this screen before a round is built.
 *
 * `maxRows`: the tallest grid that keeps 56dp cells in the board's height, less the strip a tall
 * board carries above it (Flash Grid's «N칸» and waves) — so a portrait 5×7 board is only offered
 * where it fits without scrolling.
 */
export function mobilePlatform(boardWidth: number, boardHeight: number): PlatformContext & { maxRows: number } {
  return {
    maxCols: maxColsFor(boardWidth),
    maxRows: maxRowsFor(boardHeight - BOARD_STRIP_H),
  }
}

/** Widest a board gets on a tablet — past this, cells only grow and the eyes travel further. */
export const MAX_BOARD_WIDTH = 560

/** "1:05" — the round's time on the results screen. */
export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
