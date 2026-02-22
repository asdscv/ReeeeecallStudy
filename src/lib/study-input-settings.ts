// ── Study Input Settings ─────────────────────────────
// Centralized module for answer input mode (button vs swipe).
// Consolidates SwipeSettings from 3 files into one source of truth.

import i18next from 'i18next'
import type { StudyMode } from '../types/database'

export type AnswerInputMode = 'button' | 'swipe'
export type SwipeAction = 'again' | 'hard' | 'good' | 'easy' | 'unknown' | 'known' | ''

export interface SwipeDirectionMap {
  left: SwipeAction
  right: SwipeAction
  up: SwipeAction
  down: SwipeAction
}

export interface StudyInputSettings {
  version: 3
  mode: AnswerInputMode
}

// ── Constants ────────────────────────────────────────

const STORAGE_KEY = 'reeeeecall-study-input-settings'
const LEGACY_KEY = 'reeecall-swipe-settings'  // keep old key name for migration
export const SWIPE_THRESHOLD = 100

const VALID_ACTIONS: ReadonlySet<string> = new Set(['again', 'hard', 'good', 'easy', 'unknown', 'known', ''])
const VALID_MODES: ReadonlySet<string> = new Set(['button', 'swipe'])

export const DEFAULT_DIRECTIONS: SwipeDirectionMap = {
  left: 'again',
  right: 'good',
  up: '',
  down: '',
}

const DEFAULT_SETTINGS: StudyInputSettings = {
  version: 3,
  mode: 'button',
}

// ── Action color mapping ─────────────────────────────

const ACTION_COLORS: Record<string, string> = {
  again: 'rgba(239, 68, 68, VAR)',   // red-500
  hard: 'rgba(249, 115, 22, VAR)',   // orange-500
  good: 'rgba(34, 197, 94, VAR)',    // green-500
  easy: 'rgba(59, 130, 246, VAR)',   // blue-500
  unknown: 'rgba(239, 68, 68, VAR)', // red-500
  known: 'rgba(34, 197, 94, VAR)',   // green-500
}

// ── Action labels (per-action i18n) ──────────────────

const ACTION_I18N_KEYS: Record<string, string> = {
  again: 'study:srsRating.again',
  hard: 'study:srsRating.hard',
  good: 'study:srsRating.good',
  easy: 'study:srsRating.easy',
  unknown: 'study:rating.unknown',
  known: 'study:rating.known',
}

export function getActionLabel(action: string): string {
  const key = ACTION_I18N_KEYS[action]
  if (key) return i18next.t(key, { defaultValue: action })
  return action
}

// ── Fixed directions per study mode ─────────────────

export function getDirectionsForMode(mode?: StudyMode): SwipeDirectionMap {
  if (mode === 'srs') {
    return { left: 'again', right: 'good', up: '', down: '' }
  }
  // sequential_review, cramming, random, sequential, by_date
  return { left: 'unknown', right: 'known', up: '', down: '' }
}

// ── Validators ───────────────────────────────────────

export function isValidAction(value: unknown): value is SwipeAction {
  return typeof value === 'string' && VALID_ACTIONS.has(value)
}

export function isValidMode(value: unknown): value is AnswerInputMode {
  return typeof value === 'string' && VALID_MODES.has(value)
}

export function validateSettings(raw: unknown): StudyInputSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const obj = raw as Record<string, unknown>
  return {
    version: 3,
    mode: isValidMode(obj.mode) ? obj.mode : DEFAULT_SETTINGS.mode,
  }
}

// ── Legacy Migration ─────────────────────────────────

interface LegacySwipeSettings {
  enabled: boolean
  left: string
  right: string
  up: string
  down: string
}

export function migrateLegacy(raw: unknown): StudyInputSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS }
  }
  const legacy = raw as Partial<LegacySwipeSettings>
  const mode: AnswerInputMode = legacy.enabled ? 'swipe' : 'button'
  return { version: 3, mode }
}

// ── Persistence ──────────────────────────────────────

export function loadSettings(): StudyInputSettings {
  // v3/v2 first
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) {
    try {
      return validateSettings(JSON.parse(raw))
    } catch { /* fall through */ }
  }

  // legacy migration
  const legacyRaw = localStorage.getItem(LEGACY_KEY)
  if (legacyRaw) {
    try {
      const migrated = migrateLegacy(JSON.parse(legacyRaw))
      // Save as v3 and remove legacy
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
      localStorage.removeItem(LEGACY_KEY)
      return migrated
    } catch { /* fall through */ }
  }

  return { ...DEFAULT_SETTINGS }
}

export function saveSettings(settings: StudyInputSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

// ── Derived Booleans ─────────────────────────────────

export function shouldShowButtons(settings: StudyInputSettings): boolean {
  return settings.mode === 'button'
}

export function shouldEnableSwipe(settings: StudyInputSettings): boolean {
  return settings.mode === 'swipe'
}

// ── Swipe Hint Text ──────────────────────────────────

type Direction = 'left' | 'right' | 'up' | 'down'

const DIRECTION_ARROWS: Record<Direction, string> = {
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
}

export function buildSwipeHintParts(dirs: SwipeDirectionMap): { arrow: string; label: string }[] {
  const order: Direction[] = ['left', 'up', 'down', 'right']
  const parts: { arrow: string; label: string }[] = []
  for (const d of order) {
    const action = dirs[d]
    if (action) {
      parts.push({ arrow: DIRECTION_ARROWS[d], label: getActionLabel(action) })
    }
  }
  return parts
}

export function buildSwipeHintText(dirs: SwipeDirectionMap): string {
  const parts = buildSwipeHintParts(dirs)
  return parts.map(p => `${p.arrow} ${p.label}`).join(' | ')
}

// ── Swipe Resolution ─────────────────────────────────

/** Minimum velocity (px/ms) that allows reduced-distance swipe detection */
export const SWIPE_VELOCITY_THRESHOLD = 0.4
/** When velocity exceeds SWIPE_VELOCITY_THRESHOLD, the distance threshold drops to this */
export const SWIPE_VELOCITY_DISTANCE = 15

export interface SwipeResult {
  action: SwipeAction
  direction: Direction
}

export function resolveSwipeAction(
  dx: number,
  dy: number,
  dirs: SwipeDirectionMap,
  threshold: number = SWIPE_THRESHOLD,
  velocity?: number,
): SwipeResult | null {
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)

  // Use reduced threshold if velocity is high enough
  const effectiveThreshold =
    velocity != null && velocity >= SWIPE_VELOCITY_THRESHOLD
      ? SWIPE_VELOCITY_DISTANCE
      : threshold

  // Must exceed threshold
  if (absDx < effectiveThreshold && absDy < effectiveThreshold) return null

  let direction: Direction
  if (absDx > absDy) {
    direction = dx > 0 ? 'right' : 'left'
  } else {
    direction = dy > 0 ? 'down' : 'up'
  }

  const action = dirs[direction]
  if (!action) return null

  return { action, direction }
}

// ── Swipe Preview (during drag) ──────────────────────

export interface SwipePreview {
  action: SwipeAction
  direction: Direction
  progress: number // 0..1
  color: string
  label: string
}

export const DEAD_ZONE = 8

export function previewSwipeAction(
  dx: number,
  dy: number,
  dirs: SwipeDirectionMap,
): SwipePreview | null {
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)

  // No visual feedback until swipe threshold is reached
  if (absDx < SWIPE_THRESHOLD && absDy < SWIPE_THRESHOLD) return null

  let direction: Direction
  if (absDx > absDy) {
    direction = dx > 0 ? 'right' : 'left'
  } else {
    direction = dy > 0 ? 'down' : 'up'
  }

  const action = dirs[direction]
  if (!action) return null

  const colorTemplate = ACTION_COLORS[action]
  const color = colorTemplate ? colorTemplate.replace('VAR', '0.4') : 'transparent'
  const label = getActionLabel(action) ?? ''

  return { action, direction, progress: 1, color, label }
}

// ── Touch Action ─────────────────────────────────────

/**
 * Compute the CSS `touch-action` value based on configured swipe directions.
 *
 * - Horizontal-only (left/right): `pan-y` → allows vertical card-content scroll
 * - Vertical-only (up/down):      `pan-x` → allows horizontal card-content scroll
 * - Both axes:                     `none`  → full gesture control, no scroll
 * - No directions / inactive:      `auto`  → normal browser behaviour
 */
export function computeTouchAction(dirs: SwipeDirectionMap, isSwipeActive: boolean): string {
  if (!isSwipeActive) return 'auto'
  const hasH = !!dirs.left || !!dirs.right
  const hasV = !!dirs.up || !!dirs.down
  if (hasH && hasV) return 'none'
  if (hasH) return 'pan-y'
  if (hasV) return 'pan-x'
  return 'auto'
}

export function getActionColor(action: SwipeAction, opacity: number): string {
  const template = ACTION_COLORS[action]
  if (!template) return 'transparent'
  return template.replace('VAR', String(opacity))
}
