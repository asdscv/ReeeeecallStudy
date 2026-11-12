import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Layout } from '../Layout'

// ─── Mocks ──────────────────────────────────────────────────
let mockRole = 'user'
vi.mock('../../../stores/auth-store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { email: 'test@example.com' }, role: mockRole, signOut: vi.fn() }
    return selector ? selector(state) : state
  },
}))

const renderLayout = (initialPath = '/dashboard') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Layout />
    </MemoryRouter>,
  )

const sidebar = () => screen.getByTestId('sidebar')

beforeEach(() => {
  vi.clearAllMocks()
  mockRole = 'user'
})

/**
 * Every destination is one click from the sidebar. The old top bar hid decks, AI, explore and
 * records two levels deep inside a "학습" dropdown; nothing is behind a toggle any more.
 */
describe('sidebar', () => {
  it('shows every destination at once, with no toggles', () => {
    renderLayout()
    const nav = sidebar()
    for (const label of [
      'nav.quickStudy', 'nav.dashboard', 'nav.brainTraining', 'nav.decks', 'nav.cardTemplates',
      'nav.aiHubHome', 'nav.marketplace', 'nav.publisher', 'nav.myShares', 'nav.studyHistory',
      'nav.achievements', 'nav.guide', 'nav.settings',
    ]) {
      expect(within(nav).getByText(label), label).toBeInTheDocument()
    }
    expect(within(nav).queryByRole('button')).not.toBeInTheDocument()
  })

  it('links point at their routes', () => {
    renderLayout()
    const nav = sidebar()
    const href = (label: string) => within(nav).getByText(label).closest('a')?.getAttribute('href')
    expect(href('nav.quickStudy')).toBe('/quick-study')
    expect(href('nav.brainTraining')).toBe('/brain')
    expect(href('nav.decks')).toBe('/decks')
    expect(href('nav.cardTemplates')).toBe('/templates')
    expect(href('nav.aiHubHome')).toBe('/ai')
    expect(href('nav.marketplace')).toBe('/marketplace')
    expect(href('nav.studyHistory')).toBe('/history')
    expect(href('nav.achievements')).toBe('/achievements')
  })

  it('marks the current page, on a segment boundary', () => {
    renderLayout('/decks/abc')
    const nav = sidebar()
    expect(within(nav).getByText('nav.decks').closest('a')).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByText('nav.dashboard').closest('a')).not.toHaveAttribute('aria-current')
  })

  it("does not light the AI hub on its sibling '/ai-generate'", () => {
    renderLayout('/ai-generate')
    expect(within(sidebar()).getByText('nav.aiHubHome').closest('a')).not.toHaveAttribute('aria-current')
  })

  it('shows admin only to admins', () => {
    renderLayout()
    expect(within(sidebar()).queryByText('nav.admin')).not.toBeInTheDocument()
    mockRole = 'admin'
    renderLayout()
    expect(screen.getAllByText('nav.admin').length).toBeGreaterThan(0)
  })
})

describe('bottom tabs (phone and tablet)', () => {
  it('has the four main places and a menu button', () => {
    renderLayout()
    const tabs = screen.getByTestId('bottom-tabs')
    expect(within(tabs).getByTestId('tab-home')).toHaveAttribute('href', '/dashboard')
    expect(within(tabs).getByTestId('tab-study')).toHaveAttribute('href', '/quick-study')
    expect(within(tabs).getByTestId('tab-decks')).toHaveAttribute('href', '/decks')
    expect(within(tabs).getByTestId('tab-brain')).toHaveAttribute('href', '/brain')
    expect(within(tabs).getByTestId('tab-menu')).toBeInTheDocument()
  })

  it('lights the decks tab on templates too', () => {
    renderLayout('/templates')
    expect(screen.getByTestId('tab-decks')).toHaveAttribute('aria-current', 'page')
  })

  it('lights the menu tab on a page that is not one of the four', () => {
    renderLayout('/marketplace')
    const menu = screen.getByTestId('tab-menu')
    expect(menu.className).toContain('text-brand-active')
    expect(screen.getByTestId('tab-home')).not.toHaveAttribute('aria-current')
  })
})

describe('menu sheet', () => {
  it('opens from the tab bar with every destination, and closes on Escape', async () => {
    const user = userEvent.setup()
    renderLayout()
    expect(screen.queryByTestId('menu-sheet')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('tab-menu'))
    const sheet = screen.getByTestId('menu-sheet')
    expect(within(sheet).getByText('nav.marketplace')).toBeInTheDocument()
    expect(within(sheet).getByText('nav.achievements')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('menu-sheet')).not.toBeInTheDocument()
  })

  it('opens from the header button and closes when a row is followed', async () => {
    const user = userEvent.setup()
    renderLayout()
    await user.click(screen.getByTestId('header-menu'))
    const sheet = screen.getByTestId('menu-sheet')
    await user.click(within(sheet).getByText('nav.decks'))
    expect(screen.queryByTestId('menu-sheet')).not.toBeInTheDocument()
  })
})
