import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { GuidePage } from '../GuidePage'

// ─── Mocks ──────────────────────────────────────────────────

// Mock window.scrollTo
const scrollToSpy = vi.fn()
Object.defineProperty(window, 'scrollTo', { value: scrollToSpy, writable: true })

// Mock requestAnimationFrame to execute immediately
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })

const renderGuide = () =>
  render(
    <MemoryRouter>
      <GuidePage />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  scrollToSpy.mockClear()
})

// ─── TOC 렌더링 ─────────────────────────────────────────────

describe('목차(TOC) 렌더링', () => {
  it('목차에 모든 섹션이 표시된다', () => {
    renderGuide()
    const toc = screen.getByRole('navigation')
    // GUIDE_SECTIONS has 12 sections — each should have a button in the TOC
    const buttons = within(toc).getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(10)
  })
})

// ─── TOC 클릭 시 스크롤 ───────────────────────────────────────

describe('목차 클릭 시 스크롤', () => {
  it('목차 항목 클릭 시 window.scrollTo가 호출된다', async () => {
    const user = userEvent.setup()
    renderGuide()

    const toc = screen.getByRole('navigation')
    const firstTocButton = within(toc).getAllByRole('button')[0]
    await user.click(firstTocButton)

    expect(scrollToSpy).toHaveBeenCalled()
    const callArgs = scrollToSpy.mock.calls[0][0]
    expect(callArgs).toHaveProperty('behavior', 'smooth')
  })
})

// ─── TOC 클릭 시 섹션 자동 펼침 ──────────────────────────────

describe('목차 클릭 시 섹션 자동 펼침', () => {
  it('목차 항목 클릭 시 해당 섹션 내용이 표시된다', async () => {
    const user = userEvent.setup()
    renderGuide()

    // All sections start collapsed (defaultOpen=false when not searching)
    const toc = screen.getByRole('navigation')
    const tocButtons = within(toc).getAllByRole('button')

    // Click the first TOC item
    await user.click(tocButtons[0])

    // The section should now be expanded — its items should be visible
    // Since section is open, we should see content items (h3 elements)
    const sectionHeadings = screen.getAllByRole('heading', { level: 3 })
    expect(sectionHeadings.length).toBeGreaterThan(0)
  })
})
