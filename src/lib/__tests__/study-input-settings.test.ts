import {
  isValidAction,
  isValidMode,
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
  getDirectionsForMode,
  getActionLabel,
  SWIPE_THRESHOLD,
  DEAD_ZONE,
  SWIPE_VELOCITY_THRESHOLD,
  SWIPE_VELOCITY_DISTANCE,
  computeTouchAction,
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
  it('accepts valid SRS actions', () => {
    expect(isValidAction('again')).toBe(true)
    expect(isValidAction('hard')).toBe(true)
    expect(isValidAction('good')).toBe(true)
    expect(isValidAction('easy')).toBe(true)
    expect(isValidAction('')).toBe(true)
  })

  it('accepts unknown/known actions', () => {
    expect(isValidAction('unknown')).toBe(true)
    expect(isValidAction('known')).toBe(true)
  })

  it('rejects invalid values', () => {
    expect(isValidAction('bogus')).toBe(false)
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

describe('validateSettings', () => {
  it('returns defaults for null', () => {
    const result = validateSettings(null)
    expect(result.version).toBe(3)
    expect(result.mode).toBe('button')
  })

  it('preserves valid data', () => {
    const input = { version: 3, mode: 'swipe' }
    const result = validateSettings(input)
    expect(result.mode).toBe('swipe')
    expect(result.version).toBe(3)
  })

  it('corrects invalid mode', () => {
    const result = validateSettings({ version: 3, mode: 'tap' })
    expect(result.mode).toBe('button')
  })

  it('migrates v2 format (drops directions)', () => {
    const result = validateSettings({
      version: 2,
      mode: 'swipe',
      directions: { left: 'again', right: 'good', up: '', down: '' },
    })
    expect(result.version).toBe(3)
    expect(result.mode).toBe('swipe')
    expect((result as Record<string, unknown>).directions).toBeUndefined()
  })
})

// ── getDirectionsForMode ─────────────────────────────

describe('getDirectionsForMode', () => {
  it('returns SRS directions for srs mode', () => {
    const dirs = getDirectionsForMode('srs')
    expect(dirs).toEqual({ left: 'again', right: 'good', up: '', down: '' })
  })

  it('returns unknown/known for sequential_review', () => {
    const dirs = getDirectionsForMode('sequential_review')
    expect(dirs).toEqual({ left: 'unknown', right: 'known', up: '', down: '' })
  })

  it('returns unknown/known for cramming', () => {
    const dirs = getDirectionsForMode('cramming')
    expect(dirs).toEqual({ left: 'unknown', right: 'known', up: '', down: '' })
  })

  it('returns unknown/known for random', () => {
    const dirs = getDirectionsForMode('random')
    expect(dirs).toEqual({ left: 'unknown', right: 'known', up: '', down: '' })
  })

  it('returns unknown/known for sequential', () => {
    const dirs = getDirectionsForMode('sequential')
    expect(dirs).toEqual({ left: 'unknown', right: 'known', up: '', down: '' })
  })

  it('returns unknown/known for by_date', () => {
    const dirs = getDirectionsForMode('by_date')
    expect(dirs).toEqual({ left: 'unknown', right: 'known', up: '', down: '' })
  })

  it('returns unknown/known for undefined mode', () => {
    const dirs = getDirectionsForMode(undefined)
    expect(dirs).toEqual({ left: 'unknown', right: 'known', up: '', down: '' })
  })
})

// ── getActionLabel ───────────────────────────────────

describe('getActionLabel', () => {
  it('returns label for SRS actions', () => {
    expect(getActionLabel('again')).toBe('Again')
    expect(getActionLabel('good')).toBe('Good')
  })

  it('returns label for unknown/known actions', () => {
    expect(getActionLabel('unknown')).toBe('Unknown')
    expect(getActionLabel('known')).toBe('Known')
  })

  it('returns raw action for unknown actions', () => {
    expect(getActionLabel('bogus')).toBe('bogus')
  })
})

// ── Legacy Migration ─────────────────────────────────

describe('migrateLegacy', () => {
  it('converts enabled:true to mode:swipe', () => {
    const result = migrateLegacy({ enabled: true, left: 'again', right: 'good', up: '', down: '' })
    expect(result.version).toBe(3)
    expect(result.mode).toBe('swipe')
  })

  it('converts enabled:false to mode:button', () => {
    const result = migrateLegacy({ enabled: false, left: 'again', right: 'good', up: '', down: '' })
    expect(result.mode).toBe('button')
  })

  it('returns defaults for null input', () => {
    const result = migrateLegacy(null)
    expect(result.mode).toBe('button')
    expect(result.version).toBe(3)
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
    expect(result.version).toBe(3)
  })

  it('loads v3 settings when present', () => {
    const stored: StudyInputSettings = { version: 3, mode: 'swipe' }
    localStorage.setItem('reeeeecall-study-input-settings', JSON.stringify(stored))
    const result = loadSettings()
    expect(result.mode).toBe('swipe')
  })

  it('migrates v2 settings to v3', () => {
    const stored = {
      version: 2,
      mode: 'swipe',
      directions: { left: 'again', right: 'good', up: '', down: '' },
    }
    localStorage.setItem('reeeeecall-study-input-settings', JSON.stringify(stored))
    const result = loadSettings()
    expect(result.mode).toBe('swipe')
    expect(result.version).toBe(3)
  })

  it('migrates legacy settings and removes legacy key', () => {
    localStorage.setItem('reeecall-swipe-settings', JSON.stringify({
      enabled: true, left: 'again', right: 'easy', up: '', down: '',
    }))
    const result = loadSettings()
    expect(result.mode).toBe('swipe')
    // Legacy key should be removed
    expect(localStorage.getItem('reeecall-swipe-settings')).toBeNull()
    // v3 key should be saved
    expect(localStorage.getItem('reeeeecall-study-input-settings')).not.toBeNull()
  })

  it('prefers v3 over legacy', () => {
    localStorage.setItem('reeeeecall-study-input-settings', JSON.stringify({
      version: 3, mode: 'button',
    }))
    localStorage.setItem('reeecall-swipe-settings', JSON.stringify({
      enabled: true, left: 'again', right: 'good', up: '', down: '',
    }))
    const result = loadSettings()
    expect(result.mode).toBe('button') // v3 wins
  })
})

describe('saveSettings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores settings in localStorage', () => {
    const settings: StudyInputSettings = { version: 3, mode: 'swipe' }
    saveSettings(settings)
    const stored = JSON.parse(localStorage.getItem('reeeeecall-study-input-settings')!)
    expect(stored.mode).toBe('swipe')
    expect(stored.version).toBe(3)
  })
})

// ── Derived Booleans ─────────────────────────────────

describe('shouldShowButtons / shouldEnableSwipe', () => {
  const buttonSettings: StudyInputSettings = { version: 3, mode: 'button' }
  const swipeSettings: StudyInputSettings = { version: 3, mode: 'swipe' }

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

  it('works with unknown/known actions', () => {
    const dirs: SwipeDirectionMap = { left: 'unknown', right: 'known', up: '', down: '' }
    const parts = buildSwipeHintParts(dirs)
    expect(parts).toEqual([
      { arrow: '←', label: 'Unknown' },
      { arrow: '→', label: 'Known' },
    ])
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
    // SWIPE_THRESHOLD is 30, so 20,15 should be below
    expect(resolveSwipeAction(20, 15, dirs)).toBeNull()
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

  it('works with unknown/known actions', () => {
    const nonSrsDirs: SwipeDirectionMap = { left: 'unknown', right: 'known', up: '', down: '' }
    expect(resolveSwipeAction(-150, 0, nonSrsDirs)).toEqual({ action: 'unknown', direction: 'left' })
    expect(resolveSwipeAction(150, 0, nonSrsDirs)).toEqual({ action: 'known', direction: 'right' })
  })

  // ── Velocity-based detection ──────────────────────────

  it('triggers swipe at reduced distance with high velocity', () => {
    // Below normal threshold but above SWIPE_VELOCITY_DISTANCE
    // velocity >= SWIPE_VELOCITY_THRESHOLD
    const result = resolveSwipeAction(SWIPE_VELOCITY_DISTANCE + 5, 0, dirs, undefined, SWIPE_VELOCITY_THRESHOLD + 0.1)
    expect(result).not.toBeNull()
    expect(result!.action).toBe('good')
    expect(result!.direction).toBe('right')
  })

  it('does not trigger at reduced distance with low velocity', () => {
    // Below normal threshold (30) and velocity below SWIPE_VELOCITY_THRESHOLD
    const result = resolveSwipeAction(20, 0, dirs, undefined, SWIPE_VELOCITY_THRESHOLD - 0.2)
    expect(result).toBeNull()
  })

  it('uses normal threshold when velocity is undefined', () => {
    // 25 < SWIPE_THRESHOLD (30), no velocity
    expect(resolveSwipeAction(25, 0, dirs)).toBeNull()
    // 35 > SWIPE_THRESHOLD (30), no velocity
    expect(resolveSwipeAction(35, 0, dirs)).not.toBeNull()
  })

  it('velocity detection works in all directions', () => {
    const highVel = 0.5
    expect(resolveSwipeAction(-30, 0, dirs, undefined, highVel)?.direction).toBe('left')
    expect(resolveSwipeAction(30, 0, dirs, undefined, highVel)?.direction).toBe('right')
    expect(resolveSwipeAction(0, -30, dirs, undefined, highVel)?.direction).toBe('up')
    expect(resolveSwipeAction(0, 30, dirs, undefined, highVel)?.direction).toBe('down')
  })
})

// ── Preview ──────────────────────────────────────────

describe('previewSwipeAction', () => {
  const dirs: SwipeDirectionMap = { left: 'again', right: 'good', up: '', down: '' }

  it(`returns null in dead zone (< ${DEAD_ZONE}px)`, () => {
    // DEAD_ZONE is 8, so 5,3 should be inside dead zone
    expect(previewSwipeAction(5, 3, dirs)).toBeNull()
  })

  it('calculates progress 0 at dead zone boundary', () => {
    const result = previewSwipeAction(DEAD_ZONE, 0, dirs)
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

  it('works with unknown/known actions', () => {
    const nonSrsDirs: SwipeDirectionMap = { left: 'unknown', right: 'known', up: '', down: '' }
    const result = previewSwipeAction(-60, 0, nonSrsDirs)
    expect(result!.action).toBe('unknown')
    expect(result!.label).toBe('Unknown')
    expect(result!.color).toContain('rgba')
  })
})

// ── Touch Action ────────────────────────────────────

describe('computeTouchAction', () => {
  it('returns auto when inactive', () => {
    const dirs: SwipeDirectionMap = { left: 'again', right: 'good', up: 'hard', down: 'easy' }
    expect(computeTouchAction(dirs, false)).toBe('auto')
  })

  it('returns pan-y for horizontal-only swipe', () => {
    const dirs: SwipeDirectionMap = { left: 'again', right: 'good', up: '', down: '' }
    expect(computeTouchAction(dirs, true)).toBe('pan-y')
  })

  it('returns pan-x for vertical-only swipe', () => {
    const dirs: SwipeDirectionMap = { left: '', right: '', up: 'hard', down: 'easy' }
    expect(computeTouchAction(dirs, true)).toBe('pan-x')
  })

  it('returns none for four-direction swipe', () => {
    const dirs: SwipeDirectionMap = { left: 'again', right: 'good', up: 'hard', down: 'easy' }
    expect(computeTouchAction(dirs, true)).toBe('none')
  })

  it('returns none for mixed axes (left + up)', () => {
    const dirs: SwipeDirectionMap = { left: 'again', right: '', up: 'hard', down: '' }
    expect(computeTouchAction(dirs, true)).toBe('none')
  })

  it('returns auto when no directions configured', () => {
    const dirs: SwipeDirectionMap = { left: '', right: '', up: '', down: '' }
    expect(computeTouchAction(dirs, true)).toBe('auto')
  })

  it('returns pan-y for single horizontal direction', () => {
    const dirs: SwipeDirectionMap = { left: 'again', right: '', up: '', down: '' }
    expect(computeTouchAction(dirs, true)).toBe('pan-y')
  })
})
