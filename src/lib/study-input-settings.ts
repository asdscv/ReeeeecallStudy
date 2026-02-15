// ── Study Input Settings ─────────────────────────────
// Centralized module for answer input mode (button vs swipe).
// Consolidates SwipeSettings from 3 files into one source of truth.

export type AnswerInputMode = 'button' | 'swipe'
export type SwipeAction = 'again' | 'hard' | 'good' | 'easy' | ''

export interface SwipeDirectionMap {
  left: SwipeAction
  right: SwipeAction
  up: SwipeAction
  down: SwipeAction
}

export interface StudyInputSettings {
  version: 2
  mode: AnswerInputMode
  directions: SwipeDirectionMap
}

// ── Constants ────────────────────────────────────────

const STORAGE_KEY = 'reeeeecall-study-input-settings'
const LEGACY_KEY = 'reeecall-swipe-settings'  // keep old key name for migration
export const SWIPE_THRESHOLD = 100

const VALID_ACTIONS: ReadonlySet<string> = new Set(['again', 'hard', 'good', 'easy', ''])
const VALID_MODES: ReadonlySet<string> = new Set(['button', 'swipe'])

const DEFAULT_DIRECTIONS: SwipeDirectionMap = {
  left: 'again',
  right: 'good',
  up: '',
  down: '',
}

const DEFAULT_SETTINGS: StudyInputSettings = {
  version: 2,
  mode: 'button',
  directions: { ...DEFAULT_DIRECTIONS },
}

// ── Action color mapping ─────────────────────────────

const ACTION_COLORS: Record<string, string> = {
  again: 'rgba(239, 68, 68, VAR)',   // red-500
  hard: 'rgba(249, 115, 22, VAR)',   // orange-500
  good: 'rgba(34, 197, 94, VAR)',    // green-500
  easy: 'rgba(59, 130, 246, VAR)',   // blue-500
}

const ACTION_LABELS: Record<string, string> = {
  again: 'Again',
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy',
}

// ── Validators ───────────────────────────────────────

export function isValidAction(value: unknown): value is SwipeAction {
  return typeof value === 'string' && VALID_ACTIONS.has(value)
}

export function isValidMode(value: unknown): value is AnswerInputMode {
  return typeof value === 'string' && VALID_MODES.has(value)
}

export function validateDirections(raw: unknown): SwipeDirectionMap {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_DIRECTIONS }
  const obj = raw as Record<string, unknown>
  return {
    left: isValidAction(obj.left) ? obj.left : DEFAULT_DIRECTIONS.left,
    right: isValidAction(obj.right) ? obj.right : DEFAULT_DIRECTIONS.right,
    up: isValidAction(obj.up) ? obj.up : DEFAULT_DIRECTIONS.up,
    down: isValidAction(obj.down) ? obj.down : DEFAULT_DIRECTIONS.down,
  }
}

export function validateSettings(raw: unknown): StudyInputSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS, directions: { ...DEFAULT_SETTINGS.directions } }
  const obj = raw as Record<string, unknown>
  return {
    version: 2,
    mode: isValidMode(obj.mode) ? obj.mode : DEFAULT_SETTINGS.mode,
    directions: validateDirections(obj.directions),
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
    return { ...DEFAULT_SETTINGS, directions: { ...DEFAULT_SETTINGS.directions } }
  }
  const legacy = raw as Partial<LegacySwipeSettings>
  const mode: AnswerInputMode = legacy.enabled ? 'swipe' : 'button'
  const directions: SwipeDirectionMap = {
    left: isValidAction(legacy.left) ? legacy.left : DEFAULT_DIRECTIONS.left,
    right: isValidAction(legacy.right) ? legacy.right : DEFAULT_DIRECTIONS.right,
    up: isValidAction(legacy.up) ? legacy.up : DEFAULT_DIRECTIONS.up,
    down: isValidAction(legacy.down) ? legacy.down : DEFAULT_DIRECTIONS.down,
  }
  return { version: 2, mode, directions }
}

// ── Persistence ──────────────────────────────────────

export function loadSettings(): StudyInputSettings {
  // v2 first
  const v2Raw = localStorage.getItem(STORAGE_KEY)
  if (v2Raw) {
    try {
      return validateSettings(JSON.parse(v2Raw))
    } catch { /* fall through */ }
  }

  // legacy migration
  const legacyRaw = localStorage.getItem(LEGACY_KEY)
  if (legacyRaw) {
    try {
      const migrated = migrateLegacy(JSON.parse(legacyRaw))
      // Save as v2 and remove legacy
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
      localStorage.removeItem(LEGACY_KEY)
      return migrated
    } catch { /* fall through */ }
  }

  return { ...DEFAULT_SETTINGS, directions: { ...DEFAULT_SETTINGS.directions } }
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
      parts.push({ arrow: DIRECTION_ARROWS[d], label: ACTION_LABELS[action] })
    }
  }
  return parts
}

export function buildSwipeHintText(dirs: SwipeDirectionMap): string {
  const parts = buildSwipeHintParts(dirs)
  return parts.map(p => `${p.arrow} ${p.label}`).join(' | ')
}

// ── Swipe Resolution ─────────────────────────────────

export interface SwipeResult {
  action: SwipeAction
  direction: Direction
}

export function resolveSwipeAction(
  dx: number,
  dy: number,
  dirs: SwipeDirectionMap,
  threshold: number = SWIPE_THRESHOLD,
): SwipeResult | null {
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)

  // Must exceed threshold
  if (absDx < threshold && absDy < threshold) return null

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

const DEAD_ZONE = 20

export function previewSwipeAction(
  dx: number,
  dy: number,
  dirs: SwipeDirectionMap,
): SwipePreview | null {
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)

  // Dead zone
  if (absDx < DEAD_ZONE && absDy < DEAD_ZONE) return null

  let direction: Direction
  let distance: number
  if (absDx > absDy) {
    direction = dx > 0 ? 'right' : 'left'
    distance = absDx
  } else {
    direction = dy > 0 ? 'down' : 'up'
    distance = absDy
  }

  const action = dirs[direction]
  if (!action) return null

  const progress = Math.min(1, Math.max(0, (distance - DEAD_ZONE) / (SWIPE_THRESHOLD - DEAD_ZONE)))
  const colorTemplate = ACTION_COLORS[action]
  const color = colorTemplate ? colorTemplate.replace('VAR', String(progress * 0.4)) : 'transparent'
  const label = ACTION_LABELS[action] ?? ''

  return { action, direction, progress, color, label }
}

export function getActionColor(action: SwipeAction, opacity: number): string {
  const template = ACTION_COLORS[action]
  if (!template) return 'transparent'
  return template.replace('VAR', String(opacity))
}
