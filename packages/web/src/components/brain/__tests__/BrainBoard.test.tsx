import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GAME_THEMES, type CellView, type ChoiceView, type GridView } from '@reeeeecall/shared/lib/brain-games'
import { BrainBoard } from '../BrainBoard'
import { CELL_INK } from '../brain-ui'

/**
 * The board draws every field the engine's views can carry. No game emits most of them yet, so
 * these are fixture views shaped like the plan's (GAMES_DIFFICULTY_PLAN §2.1, §3).
 */

const noop = () => {}

function grid(over: Partial<GridView> = {}): GridView {
  const cells: CellView[] = Array.from({ length: 9 }, () => ({ label: 'F', tone: 'idle' }))
  return { kind: 'grid', cols: 3, rows: 3, cells, prompt: { key: 'play.findOdd' }, locked: false, ...over }
}

function choice(over: Partial<ChoiceView> = {}, stimulus: Partial<ChoiceView['stimulus']> = {}): ChoiceView {
  return {
    kind: 'choice',
    prompt: { key: 'play.solve' },
    stimulus: { text: '3 + 5 = ?', ...stimulus },
    options: [{ value: 6 }, { value: 7 }, { value: 8 }, { value: 9 }],
    ...over,
  }
}

function draw(view: GridView | ChoiceView, onTap: (i: number) => void = noop, extra: { demo?: boolean; onSkip?: () => void } = {}) {
  return render(<BrainBoard view={view} onTap={onTap} onExposure={noop} width={390} theme={GAME_THEMES.oddOneOut} {...extra} />)
}

describe('BrainBoard — grid fields', () => {
  it('draws a mirrored cell mirrored first, then turned; inks and boxes labels', () => {
    const cells: CellView[] = [
      { label: 'F', tone: 'idle', rotate: 45, mirror: true },
      { label: '7', tone: 'idle', ink: 'amber', boxed: true },
      { label: 'G', tone: 'idle', ink: 'cyan' },
      ...Array.from({ length: 6 }, (): CellView => ({ label: 'F', tone: 'idle', rotate: 90 })),
    ]
    draw(grid({ cells }))
    const mirrored = screen.getByTestId('brain-cell-0').querySelector('[data-mirror]') as HTMLElement
    expect(mirrored.style.transform).toBe('rotate(45deg) scaleX(-1)')
    const boxed = screen.getByTestId('brain-cell-1').querySelector('[data-boxed]') as HTMLElement
    expect(boxed.style.border).toContain('solid')
    expect(boxed.style.color).toBe(hexToRgb(CELL_INK.amber))
    expect(screen.getByTestId('brain-cell-2').textContent).toBe('G')
    expect(screen.getByTestId('brain-cell-3').querySelector('span span')?.getAttribute('style')).toContain('rotate(90deg)')
  })

  it('a label on a coloured face (right, wrong) drops its ink for contrast', () => {
    draw(grid({ cells: [{ label: 'b', tone: 'correct', ink: 'amber' }, ...grid().cells.slice(1)] }))
    const glyph = screen.getByTestId('brain-cell-0').querySelector('span span') as HTMLElement
    expect(glyph.style.color).toBe('')
  })

  it('the «없음» button sits under the grid, taps its index, and answers to N and Space', () => {
    const onTap = vi.fn()
    draw(grid({ extra: { key: 'play.noneOdd', index: 9 } }), onTap)
    const button = screen.getByTestId('brain-extra')
    expect(button.getAttribute('data-tap')).toBe('9')
    expect(button.textContent).toContain('play.noneOdd')
    expect(button.style.minHeight).toBe('56px')
    expect(button.style.marginTop).toBe('16px')
    fireEvent.pointerDown(button)
    fireEvent.keyDown(window, { key: 'n', code: 'KeyN' })
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(onTap.mock.calls).toEqual([[9], [9], [9]])
  })

  it('Space on a focused cell is that cell, not «없음»', () => {
    const onTap = vi.fn()
    draw(grid({ extra: { key: 'play.noneOdd', index: 9 } }), onTap)
    fireEvent.keyDown(screen.getByTestId('brain-cell-4'), { key: ' ', code: 'Space' })
    expect(onTap).not.toHaveBeenCalled()
  })

  it('a locked board takes no «없음» from the keyboard', () => {
    const onTap = vi.fn()
    draw(grid({ locked: true, extra: { key: 'play.noneOdd', index: 9 } }), onTap)
    fireEvent.keyDown(window, { key: 'n', code: 'KeyN' })
    expect(onTap).not.toHaveBeenCalled()
    expect(screen.getByTestId('brain-extra')).toBeDisabled()
  })

  it('«없음» shows its verdict; when it was right and not picked, the board says «없었어요»', () => {
    const { unmount } = draw(grid({ locked: true, extra: { key: 'play.noneOdd', index: 9, tone: 'correct' } }))
    expect(screen.getByTestId('brain-extra').getAttribute('data-tone')).toBe('correct')
    expect(screen.queryByTestId('brain-none-stamp')).toBeNull()
    unmount()
    const cells = grid().cells.map((c, i): CellView => (i === 2 ? { ...c, tone: 'wrong' } : c))
    draw(grid({ locked: true, cells, extra: { key: 'play.noneOdd', index: 9, tone: 'missed' } }))
    expect(screen.getByTestId('brain-none-stamp').textContent).toBe('play.noneWas')
  })

  it('the strip carries badge, chip, waves, a set counter and the miss budget', () => {
    const { unmount } = draw(
      grid({
        badge: { key: 'play.reverseBadge' },
        chip: { key: 'play.cells', params: { count: 9 } },
        progress: { kind: 'waves', done: 1, total: 3 },
        budget: { left: 2, total: 3 },
      }),
    )
    expect(screen.getByTestId('brain-badge').textContent).toContain('play.reverseBadge')
    expect(screen.getByTestId('brain-chip').textContent).toBe('play.cells')
    const dots = screen.getByTestId('brain-waves').querySelectorAll('span')
    expect(dots).toHaveLength(3)
    expect(screen.getByTestId('brain-waves').querySelectorAll('[data-on]')).toHaveLength(1)
    const budget = screen.getByTestId('brain-budget')
    expect(budget.getAttribute('aria-label')).toBe('play.budget')
    // Dots, never hearts.
    expect(budget.querySelector('svg')).toBeNull()
    expect(budget.querySelectorAll('span[aria-hidden] > span')).toHaveLength(3)
    unmount()
    draw(grid({ chip: { text: '3씩', ink: 'amber' }, progress: { kind: 'set', open: 2, size: 3 } }))
    expect(screen.getByTestId('brain-chip').textContent).toBe('3씩')
    expect(screen.getByTestId('brain-chip').getAttribute('data-ink')).toBe('amber')
    expect(screen.getByTestId('brain-set').textContent).toBe('2/3')
  })

  it('no strip when the view carries none of its fields', () => {
    draw(grid())
    expect(screen.queryByTestId('brain-strip')).toBeNull()
  })

  it('a memorise phase draws its countdown bar under the grid', () => {
    const cells = grid().cells.map((c, i): CellView => ({ ...c, label: undefined, tone: i < 3 ? 'lit' : 'idle' }))
    draw(grid({ locked: true, cells, showBar: { ms: 1540 } }))
    expect(screen.getByTestId('brain-show-bar')).toBeInTheDocument()
  })

  it('after a miss: the odd one beside a typical one, upright, a mirror still a mirror', () => {
    const cells = grid().cells.map((c, i): CellView => (i === 7 ? { ...c, tone: 'missed', mirror: true, rotate: 135 } : { ...c, rotate: 45 }))
    draw(grid({ locked: true, cells, missChip: { odd: { label: 'F', tone: 'idle', mirror: true, rotate: 135 }, common: { label: 'F', tone: 'idle', rotate: 45 } } }))
    const chip = screen.getByTestId('brain-miss-chip')
    const glyphs = chip.querySelectorAll<HTMLElement>('span > span > span')
    expect(glyphs[0].style.transform).toBe('scaleX(-1)')
    expect(glyphs[glyphs.length - 1].style.transform).toBe('')
    // The odd cell is in the bottom row: the chip goes to the top, clear of its pulse.
    expect(chip.style.top).toBe('6px')
  })

  it('an alternation board shows its two-series legend for a moment', () => {
    vi.useFakeTimers()
    try {
      const cells = grid().cells.map((_, i): CellView => ({ label: String(i + 1), tone: 'idle', ...(i % 2 ? { ink: 'amber', boxed: true } : {}) }))
      draw(grid({ cells }))
      expect(screen.getByTestId('brain-legend').textContent).toBe('1⇄2')
    } finally {
      vi.useRealTimers()
    }
  })

  it('on an opposite-directions board the legend starts amber at its largest (it counts down)', () => {
    vi.useFakeTimers()
    try {
      // White 1-5, amber 4-1: white 1 → amber 4 → white 2 …
      const labels = ['1', '4', '2', '3', '3', '2', '4', '1', '5']
      const cells = labels.map((label, i): CellView => ({ label, tone: 'idle', ...(i % 2 ? { ink: 'amber', boxed: true } : {}) }))
      draw(grid({ cells, prompt: { key: 'play.tapAlternateOpposite', params: { lives: 3 } } }))
      expect(screen.getByTestId('brain-legend').textContent).toBe('1⇄4')
    } finally {
      vi.useRealTimers()
    }
  })

  it('the demo draws the same fields without test ids or focus', () => {
    draw(grid({ extra: { key: 'play.noneOdd', index: 9 }, chip: { text: 'x' } }), noop, { demo: true })
    expect(screen.queryByTestId('brain-extra')).toBeNull()
    const button = document.querySelector('[data-tap="9"]') as HTMLButtonElement
    expect(button.tabIndex).toBe(-1)
  })
})

describe('BrainBoard — choice fields', () => {
  it('an expression wraps only before an operator, numbers in the locale’s grouping', () => {
    draw(choice({}, { text: undefined, tokens: ['(', '?', '+', 1203, ')', '×', 4, '=', 5212] }))
    const expr = screen.getByTestId('brain-expression')
    const units = [...expr.querySelectorAll(':scope > span.whitespace-nowrap')].map((u) => u.textContent?.replace(/\u00A0/g, ' '))
    expect(units).toEqual(['(?', '+ 1,203)', '× 4', '= 5,212'])
  })

  it('a worked line formats its numbers and closes its brackets tight', () => {
    draw(choice({ options: [{ value: 1 }, { value: 2 }], picked: 0, correctIndex: 1 }, { text: undefined, tokens: [1, '+', 1], reveal: { lines: ['6 × ( 1203 − 15 ) = 7128'] } }))
    expect(screen.getByTestId('brain-reveal-lines').textContent?.replace(/\u00A0/g, ' ')).toBe('6 × (1,203 − 15) = 7,128')
  })

  it('a right answer fills the ? in place; a miss shows the worked line, the step done first highlighted', () => {
    const tokens = [6, '+', 4, '×', 7, '=', '?']
    // As math-bands.ts workedLine() writes it: space-separated, plain digits, a [start, end) highlight.
    const reveal = { lines: ['6 + 4 × 7 → 6 + 28 = 34'], highlight: [2, 5] as [number, number] }
    const options = [{ value: 34 }, { value: 70 }]
    const { unmount } = draw(choice({ options, picked: 0, correctIndex: 0 }, { text: undefined, tokens, reveal }))
    expect(screen.getByTestId('brain-expression').textContent?.replace(/\u00A0/g, ' ')).toBe('6 + 4 × 7 = 34')
    expect(screen.queryByTestId('brain-reveal-lines')).toBeNull()
    unmount()
    draw(choice({ options, picked: 1, correctIndex: 0 }, { text: undefined, tokens, reveal }))
    const lines = screen.getByTestId('brain-reveal-lines')
    expect(lines.textContent?.replace(/\u00A0/g, ' ')).toBe('6 + 4 × 7 → 6 + 28 = 34')
    const lit = [...lines.querySelectorAll<HTMLElement>('[data-token]')].filter((el) => el.style.background !== '').map((el) => el.dataset.token)
    expect(lit).toEqual(['2', '3', '4'])
    // The expression itself is left as it was asked.
    expect([...screen.getByTestId('brain-expression').querySelectorAll<HTMLElement>('[data-token]')].some((el) => el.style.background !== '')).toBe(false)
  })

  it('numeric options are drawn from `value`, in tabular digits', () => {
    draw(choice({ options: [{ value: 998 }, { value: 1003 }, { value: 1203 }, { value: 1213 }] }))
    expect(screen.getByTestId('brain-option-2').textContent).toContain('1,203')
    expect(screen.getByTestId('brain-option-2').className).toContain('tabular-nums')
  })

  it('a pattern row is tiles with a pulsing gap, filled once answered, with the rule’s gaps and lines', () => {
    const terms = [3, 5, null, 9]
    const { unmount } = draw(choice({ options: [{ value: 6 }, { value: 7 }] }, { text: undefined, terms }))
    const gap = screen.getByTestId('brain-terms').querySelector<HTMLElement>('[data-term="2"]') as HTMLElement
    expect(gap.textContent).toBe('?')
    expect(gap.style.animation).toContain('bfx-pulse')
    unmount()
    draw(choice({ options: [{ value: 6 }, { value: 7 }], picked: 1, correctIndex: 1 }, { text: undefined, terms, reveal: { gaps: ['+2', '+2', '+2'], groups: [0, 1, 0, 1] } }))
    const row = screen.getByTestId('brain-terms')
    expect(row.querySelector('[data-term="2"]')?.textContent).toContain('7')
    expect(row.querySelectorAll('[data-gap]')).toHaveLength(3)
    expect((row.querySelector('[data-term="1"]') as HTMLElement).style.border).toContain('dashed')
  })

  it('Color Word: the cue strip, the hidden word during the lead, the frame ring', () => {
    const onTap = vi.fn()
    const { unmount } = draw(choice({ options: [{ textKey: 'colors.red' }, { textKey: 'colors.blue' }] }, { text: undefined, textKey: 'colors.red', color: 'blue', cue: 'word', hidden: true }), onTap)
    expect(screen.getByTestId('brain-cue').getAttribute('data-cue')).toBe('word')
    expect(screen.getByTestId('brain-cue').textContent).toContain('play.cueWord')
    expect(screen.getByTestId('brain-stimulus').textContent).not.toContain('colors.red')
    expect(screen.getByTestId('brain-option-0')).toBeDisabled()
    fireEvent.keyDown(window, { key: '1' })
    expect(onTap).not.toHaveBeenCalled()
    unmount()
    draw(choice({ options: [{ textKey: 'colors.red' }, { textKey: 'colors.blue' }] }, { text: undefined, textKey: 'colors.red', color: 'blue', cue: 'ink', frame: 'green' }), onTap)
    expect(screen.getByTestId('brain-stimulus').textContent).toContain('colors.red')
    expect(screen.getByTestId('brain-stimulus').getAttribute('data-frame')).toBe('green')
    expect(screen.getByTestId('brain-stimulus').style.boxShadow).toContain('inset 0 0 0 12px')
    fireEvent.keyDown(window, { key: '2' })
    expect(onTap).toHaveBeenCalledWith(1)
  })

  it('coloured labels are ink on a white tile', () => {
    draw(choice({ options: [{ textKey: 'colors.red', color: 'purple' }, { textKey: 'colors.blue', color: 'orange' }] }, { text: undefined, textKey: 'colors.red', color: 'blue' }))
    const option = screen.getByTestId('brain-option-0')
    expect(option.style.background).toBe('rgb(255, 255, 255)')
    expect(option.getAttribute('data-color')).toBe('purple')
  })

  it('after a wrong pick the reveal prompt shows, and the reveal can be skipped', () => {
    const onSkip = vi.fn()
    draw(
      choice({ options: [{ textKey: 'colors.red' }, { textKey: 'colors.purple' }], picked: 0, correctIndex: 1 }, { text: undefined, textKey: 'colors.red', color: 'purple', reveal: { prompt: { key: 'play.inkWas', params: { color: 'colors.purple' } } } }),
      noop,
      { onSkip },
    )
    expect(screen.getByTestId('brain-reveal-prompt').textContent).toBe('play.inkWas')
    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.pointerDown(screen.getByTestId('brain-stimulus'))
    expect(onSkip).toHaveBeenCalledTimes(2)
  })
})

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
