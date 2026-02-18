import {
  isValidAction,
  isValidMode,
  validateDirections,
  validateSettings,
  migrateLegacy,
  loadSettings,
  saveSettings,
  shouldShowButtons,
  shouldEnableSwipe,
  buildSwipeHintParts,
  buildSwipeHintText,
  resolveSwipeAction,
  previewSwipeAction,
  SWIPE_THRESHOLD,
  type StudyInputSettings,
  type SwipeDirectionMap,
} from '../study-input-settings'

vi.mock('i18next', () => ({
  default: {
    t: (key: string) => {
      // Return the last segment capitalised, e.g. "study:srsRating.again" → "Again"
      const last = key.split('.').pop() ?? key
      return last.charAt(0).toUpperCase() + last.slice(1)
    },
  },
}))

// ── Validators ───────────────────────────────────────

describe('isValidAction', () => {
  it('accepts valid actions', () => {
    expect(isValidAction('again')).toBe(true)
    expect(isValidAction('hard')).toBe(true)
    expect(isValidAction('good')).toBe(true)
    expect(isValidAction('easy')).toBe(true)
    expect(isValidAction('')).toBe(true)
  })

  it('rejects invalid values', () => {
    expect(isValidAction('unknown')).toBe(false)
    expect(isValidAction(null)).toBe(false)
    expect(isValidAction(undefined)).toBe(false)
    expect(isValidAction(42)).toBe(false)
  })
})

describe('isValidMode', () => {
  it('accepts button and swipe', () => {
    expect(isValidMode('button')).toBe(true)
    expect(isValidMode('swipe')).toBe(true)
  })

  it('rejects invalid modes', () => {
    expect(isValidMode('tap')).toBe(false)
    expect(isValidMode('')).toBe(false)
    expect(isValidMode(null)).toBe(false)
  })
})

describe('validateDirections', () => {
  it('returns defaults for null/undefined', () => {
    const result = validateDirections(null)
    expect(result).toEqual({ left: 'again', right: 'good', up: '', down: '' })
  })

  it('returns defaults for non-object', () => {
    expect(validateDirections('string')).toEqual({ left: 'again', right: 'good', up: '', down: '' })
  })

  it('preserves valid directions', () => {
    const result = validateDirections({ left: 'hard', right: 'easy', up: 'again', down: 'good' })
    expect(result).toEqual({ left: 'hard', right: 'easy', up: 'again', down: 'good' })
  })

  it('replaces invalid directions with defaults', () => {
    const result = validateDirections({ left: 'invalid', right: 'good', up: 99, down: null })
    expect(result.left).toBe('again')
    expect(result.right).toBe('good')
    expect(result.up).toBe('')
    expect(result.down).toBe('')
  })
})

describe('validateSettings', () => {
  it('returns defaults for null', () => {
    const result = validateSettings(null)
    expect(result.version).toBe(2)
    expect(result.mode).toBe('button')
    expect(result.directions).toEqual({ left: 'again', right: 'good', up: '', down: '' })
  })

  it('preserves valid v2 data', () => {
    const input = {
      version: 2,
      mode: 'swipe',
      directions: { left: 'again', right: 'good', up: 'hard', down: 'easy' },
    }
    const result = validateSettings(input)
    expect(result.mode).toBe('swipe')
    expect(result.directions.up).toBe('hard')
  })

  it('corrects invalid mode', () => {
    const result = validateSettings({ version: 2, mode: 'tap', directions: {} })
    expect(result.mode).toBe('button')
  })
})

// ── Legacy Migration ─────────────────────────────────

describe('migrateLegacy', () => {
  it('converts enabled:true to mode:swipe', () => {
    const result = migrateLegacy({ enabled: true, left: 'again', right: 'good', up: '', down: '' })
    expect(result.version).toBe(2)
    expect(result.mode).toBe('swipe')
    expect(result.directions.left).toBe('again')
  })

  it('converts enabled:false to mode:button', () => {
    const result = migrateLegacy({ enabled: false, left: 'again', right: 'good', up: '', down: '' })
    expect(result.mode).toBe('button')
  })

  it('handles missing/invalid direction values', () => {
    const result = migrateLegacy({ enabled: true, left: 'invalid', right: 'good' })
    expect(result.directions.left).toBe('again') // default
    expect(result.directions.right).toBe('good')
    expect(result.directions.up).toBe('')
    expect(result.directions.down).toBe('')
  })

  it('returns defaults for null input', () => {
    const result = migrateLegacy(null)
    expect(result.mode).toBe('button')
    expect(result.version).toBe(2)
  })
})

// ── Persistence ──────────────────────────────────────

describe('loadSettings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns defaults when nothing is stored', () => {
    const result = loadSettings()
    expect(result.mode).toBe('button')
    expect(result.version).toBe(2)
  })

  it('loads v2 settings when present', () => {
    const stored: StudyInputSettings = {
      version: 2,
      mode: 'swipe',
      directions: { left: 'again', right: 'good', up: '', down: '' },
    }
    localStorage.setItem('reeeeecall-study-input-settings', JSON.stringify(stored))
    const result = loadSettings()
    expect(result.mode).toBe('swipe')
  })

  it('migrates legacy settings and removes legacy key', () => {
    localStorage.setItem('reeecall-swipe-settings', JSON.stringify({
      enabled: true, left: 'again', right: 'easy', up: '', down: '',
    }))
    const result = loadSettings()
    expect(result.mode).toBe('swipe')
    expect(result.directions.right).toBe('easy')
    // Legacy key should be removed
    expect(localStorage.getItem('reeecall-swipe-settings')).toBeNull()
    // v2 key should be saved
    expect(localStorage.getItem('reeeeecall-study-input-settings')).not.toBeNull()
  })

  it('prefers v2 over legacy', () => {
    localStorage.setItem('reeeeecall-study-input-settings', JSON.stringify({
      version: 2, mode: 'button', directions: { left: '', right: '', up: '', down: '' },
    }))
    localStorage.setItem('reeecall-swipe-settings', JSON.stringify({
      enabled: true, left: 'again', right: 'good', up: '', down: '',
    }))
    const result = loadSettings()
    expect(result.mode).toBe('button') // v2 wins
  })
})

describe('saveSettings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores settings in localStorage', () => {
    const settings: StudyInputSettings = {
      version: 2,
      mode: 'swipe',
      directions: { left: 'again', right: 'good', up: '', down: '' },
    }
    saveSettings(settings)
    const stored = JSON.parse(localStorage.getItem('reeeeecall-study-input-settings')!)
    expect(stored.mode).toBe('swipe')
    expect(stored.directions.left).toBe('again')
  })
})

// ── Derived Booleans ─────────────────────────────────

describe('shouldShowButtons / shouldEnableSwipe', () => {
  const buttonSettings: StudyInputSettings = {
    version: 2, mode: 'button',
    directions: { left: 'again', right: 'good', up: '', down: '' },
  }
  const swipeSettings: StudyInputSettings = {
    version: 2, mode: 'swipe',
    directions: { left: 'again', right: 'good', up: '', down: '' },
  }

  it('shouldShowButtons true only for button mode', () => {
    expect(shouldShowButtons(buttonSettings)).toBe(true)
    expect(shouldShowButtons(swipeSettings)).toBe(false)
  })

  it('shouldEnableSwipe true only for swipe mode', () => {
    expect(shouldEnableSwipe(swipeSettings)).toBe(true)
    expect(shouldEnableSwipe(buttonSettings)).toBe(false)
  })
})

// ── Swipe Hint Text ──────────────────────────────────

describe('buildSwipeHintParts', () => {
  it('returns parts in order left→up→down→right', () => {
    const dirs: SwipeDirectionMap = { left: 'again', right: 'good', up: 'hard', down: 'easy' }
    const parts = buildSwipeHintParts(dirs)
    expect(parts).toEqual([
      { arrow: '←', label: 'Again' },
      { arrow: '↑', label: 'Hard' },
      { arrow: '↓', label: 'Easy' },
      { arrow: '→', label: 'Good' },
    ])
  })

  it('skips unassigned directions', () => {
    const dirs: SwipeDirectionMap = { left: 'again', right: 'good', up: '', down: '' }
    const parts = buildSwipeHintParts(dirs)
    expect(parts).toHaveLength(2)
    expect(parts[0].label).toBe('Again')
    expect(parts[1].label).toBe('Good')
  })

  it('returns empty array when all directions are empty', () => {
    const dirs: SwipeDirectionMap = { left: '', right: '', up: '', down: '' }
    expect(buildSwipeHintParts(dirs)).toEqual([])
  })
})

describe('buildSwipeHintText', () => {
  it('generates formatted hint text', () => {
    const dirs: SwipeDirectionMap = { left: 'again', right: 'good', up: '', down: '' }
    expect(buildSwipeHintText(dirs)).toBe('← Again | → Good')
  })

  it('returns empty string when no directions assigned', () => {
    expect(buildSwipeHintText({ left: '', right: '', up: '', down: '' })).toBe('')
  })
})

// ── Swipe Resolution ─────────────────────────────────

describe('resolveSwipeAction', () => {
  const dirs: SwipeDirectionMap = { left: 'again', right: 'good', up: 'hard', down: 'easy' }

  it('detects right swipe', () => {
    const result = resolveSwipeAction(150, 0, dirs)
    expect(result).toEqual({ action: 'good', direction: 'right' })
  })

  it('detects left swipe', () => {
    const result = resolveSwipeAction(-150, 0, dirs)
    expect(result).toEqual({ action: 'again', direction: 'left' })
  })

  it('detects up swipe', () => {
    const result = resolveSwipeAction(0, -150, dirs)
    expect(result).toEqual({ action: 'hard', direction: 'up' })
  })

  it('detects down swipe', () => {
    const result = resolveSwipeAction(0, 150, dirs)
    expect(result).toEqual({ action: 'easy', direction: 'down' })
  })

  it('returns null when below threshold', () => {
    expect(resolveSwipeAction(50, 30, dirs)).toBeNull()
  })

  it('returns null for unassigned direction', () => {
    const partialDirs: SwipeDirectionMap = { left: 'again', right: '', up: '', down: '' }
    expect(resolveSwipeAction(150, 0, partialDirs)).toBeNull()
  })

  it('uses custom threshold', () => {
    expect(resolveSwipeAction(60, 0, dirs, 50)).not.toBeNull()
    expect(resolveSwipeAction(40, 0, dirs, 50)).toBeNull()
  })

  it('prefers horizontal when abs(dx) > abs(dy)', () => {
    const result = resolveSwipeAction(150, 100, dirs)
    expect(result?.direction).toBe('right')
  })

  it('prefers vertical when abs(dy) > abs(dx)', () => {
    const result = resolveSwipeAction(50, -150, dirs)
    expect(result?.direction).toBe('up')
  })
})

// ── Preview ──────────────────────────────────────────

describe('previewSwipeAction', () => {
  const dirs: SwipeDirectionMap = { left: 'again', right: 'good', up: '', down: '' }

  it('returns null in dead zone (< 20px)', () => {
    expect(previewSwipeAction(10, 5, dirs)).toBeNull()
  })

  it('calculates progress 0 at dead zone boundary', () => {
    const result = previewSwipeAction(20, 0, dirs)
    expect(result).not.toBeNull()
    expect(result!.progress).toBeCloseTo(0, 1)
  })

  it('calculates progress 1 at threshold', () => {
    const result = previewSwipeAction(SWIPE_THRESHOLD, 0, dirs)
    expect(result).not.toBeNull()
    expect(result!.progress).toBeCloseTo(1, 1)
  })

  it('clamps progress at 1 beyond threshold', () => {
    const result = previewSwipeAction(200, 0, dirs)
    expect(result!.progress).toBe(1)
  })

  it('returns correct action and label', () => {
    const result = previewSwipeAction(-60, 0, dirs)
    expect(result!.action).toBe('again')
    expect(result!.label).toBe('Again')
    expect(result!.direction).toBe('left')
  })

  it('returns null for unassigned direction', () => {
    expect(previewSwipeAction(0, -60, dirs)).toBeNull()
  })

  it('includes color with opacity based on progress', () => {
    const result = previewSwipeAction(60, 0, dirs)
    expect(result!.color).toContain('rgba')
    expect(result!.color).not.toBe('transparent')
  })
})
