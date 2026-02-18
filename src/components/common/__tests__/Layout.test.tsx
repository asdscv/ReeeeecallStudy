import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Layout } from '../Layout'

// ─── Mocks ──────────────────────────────────────────────────
const mockSignOut = vi.fn()
vi.mock('../../../stores/auth-store', () => ({
  useAuthStore: () => ({
    user: { email: 'test@example.com' },
    signOut: mockSignOut,
  }),
}))

const renderLayout = (initialPath = '/') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Layout />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Cycle 1: 기본 렌더링 ─────────────────────────────────────
describe('기본 렌더링', () => {
  it('탑레벨 링크 5개가 렌더된다', () => {
    renderLayout()
    const nav = screen.getAllByRole('navigation')[0] // desktop nav

    expect(within(nav).getByText('nav.quickStudy')).toBeInTheDocument()
    expect(within(nav).getByText('nav.dashboard')).toBeInTheDocument()
    expect(within(nav).getByText('nav.marketplace')).toBeInTheDocument()
    expect(within(nav).getByText('nav.studyHistory')).toBeInTheDocument()
    expect(within(nav).getByText('nav.settings')).toBeInTheDocument()
  })

  it('덱/카드 그룹 버튼이 렌더된다', () => {
    renderLayout()
    const nav = screen.getAllByRole('navigation')[0]

    expect(within(nav).getByRole('button', { name: /nav\.decksCards/ })).toBeInTheDocument()
  })

  it('가이드 그룹은 네비에 없다', () => {
    renderLayout()
    const nav = screen.getAllByRole('navigation')[0]

    expect(within(nav).queryByRole('button', { name: /guide/ })).not.toBeInTheDocument()
    expect(within(nav).queryByText('API')).not.toBeInTheDocument()
  })

  it('그룹 자식은 기본적으로 숨겨진다', () => {
    renderLayout()
    const nav = screen.getAllByRole('navigation')[0]

    // 덱/카드 그룹의 자식
    expect(within(nav).queryByText('nav.decks')).not.toBeInTheDocument()
    expect(within(nav).queryByText('nav.cards')).not.toBeInTheDocument()
  })
})

// ─── Cycle 2: 데스크톱 드롭다운 열기/닫기 ─────────────────────
describe('데스크톱 드롭다운', () => {
  it('그룹 클릭 시 자식이 표시된다', async () => {
    const user = userEvent.setup()
    renderLayout()
    const nav = screen.getAllByRole('navigation')[0]

    await user.click(within(nav).getByRole('button', { name: /nav\.decksCards/ }))

    expect(within(nav).getByText('nav.decks')).toBeInTheDocument()
    expect(within(nav).getByText('nav.cards')).toBeInTheDocument()
  })

  it('같은 그룹 재클릭 시 닫힌다', async () => {
    const user = userEvent.setup()
    renderLayout()
    const nav = screen.getAllByRole('navigation')[0]

    await user.click(within(nav).getByRole('button', { name: /nav\.decksCards/ }))
    await user.click(within(nav).getByRole('button', { name: /nav\.decksCards/ }))

    expect(within(nav).queryByText('nav.decks')).not.toBeInTheDocument()
  })

  it('외부 클릭 시 드롭다운이 닫힌다', async () => {
    const user = userEvent.setup()
    renderLayout()
    const nav = screen.getAllByRole('navigation')[0]

    await user.click(within(nav).getByRole('button', { name: /nav\.decksCards/ }))
    expect(within(nav).getByText('nav.decks')).toBeInTheDocument()

    // 외부 (body) 클릭
    await user.click(document.body)

    expect(within(nav).queryByText('nav.decks')).not.toBeInTheDocument()
  })
})

// ─── Cycle 3: 활성 상태 하이라이트 ────────────────────────────
describe('활성 상태', () => {
  it('현재 경로의 링크가 활성 스타일을 갖는다', () => {
    renderLayout('/quick-study')
    const nav = screen.getAllByRole('navigation')[0]
    const link = within(nav).getByText('nav.quickStudy').closest('a')

    expect(link).toHaveClass('bg-blue-50')
    expect(link).toHaveClass('text-blue-700')
  })

  it('자식 경로일 때 그룹 버튼이 활성 스타일을 갖는다', () => {
    renderLayout('/decks')
    const nav = screen.getAllByRole('navigation')[0]
    const btn = within(nav).getByRole('button', { name: /nav\.decksCards/ })

    expect(btn).toHaveClass('bg-blue-50')
    expect(btn).toHaveClass('text-blue-700')
  })

  it('중첩 경로(/decks/abc)에서도 그룹 버튼이 활성된다', () => {
    renderLayout('/decks/abc')
    const nav = screen.getAllByRole('navigation')[0]
    const btn = within(nav).getByRole('button', { name: /nav\.decksCards/ })

    expect(btn).toHaveClass('bg-blue-50')
  })

  it('/templates 경로에서 덱/카드 그룹이 활성된다', () => {
    renderLayout('/templates')
    const nav = screen.getAllByRole('navigation')[0]
    const btn = within(nav).getByRole('button', { name: /nav\.decksCards/ })

    expect(btn).toHaveClass('bg-blue-50')
  })
})

// ─── Cycle 4: 모바일 아코디언 ──────────────────────────────────
describe('모바일 아코디언', () => {
  it('햄버거 클릭 시 모바일 메뉴가 표시된다', async () => {
    const user = userEvent.setup()
    renderLayout()

    const hamburger = screen.getByRole('button', { name: /menu/ })
    await user.click(hamburger)

    // 모바일 메뉴에 그룹 버튼이 보인다
    const mobileNav = screen.getAllByRole('navigation')[1]
    expect(within(mobileNav).getByRole('button', { name: /nav\.decksCards/ })).toBeInTheDocument()
  })

  it('모바일 그룹 자식은 기본 숨김이다', async () => {
    const user = userEvent.setup()
    renderLayout()

    await user.click(screen.getByRole('button', { name: /menu/ }))

    const mobileNav = screen.getAllByRole('navigation')[1]
    expect(within(mobileNav).queryByText('nav.decks')).not.toBeInTheDocument()
  })

  it('모바일 그룹 클릭 시 자식이 확장된다', async () => {
    const user = userEvent.setup()
    renderLayout()

    await user.click(screen.getByRole('button', { name: /menu/ }))
    const mobileNav = screen.getAllByRole('navigation')[1]

    await user.click(within(mobileNav).getByRole('button', { name: /nav\.decksCards/ }))

    expect(within(mobileNav).getByText('nav.decks')).toBeInTheDocument()
    expect(within(mobileNav).getByText('nav.cards')).toBeInTheDocument()
  })

  it('모바일 그룹 재클릭 시 자식이 축소된다', async () => {
    const user = userEvent.setup()
    renderLayout()

    await user.click(screen.getByRole('button', { name: /menu/ }))
    const mobileNav = screen.getAllByRole('navigation')[1]

    await user.click(within(mobileNav).getByRole('button', { name: /nav\.decksCards/ }))
    await user.click(within(mobileNav).getByRole('button', { name: /nav\.decksCards/ }))

    expect(within(mobileNav).queryByText('nav.decks')).not.toBeInTheDocument()
  })

  it('모바일 자식 링크 클릭 시 메뉴가 닫힌다', async () => {
    const user = userEvent.setup()
    renderLayout()

    await user.click(screen.getByRole('button', { name: /menu/ }))
    const mobileNav = screen.getAllByRole('navigation')[1]
    await user.click(within(mobileNav).getByRole('button', { name: /nav\.decksCards/ }))

    await user.click(within(mobileNav).getByText('nav.decks'))

    // 모바일 메뉴가 닫혀서 두 번째 nav가 없어야 함
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
  })
})

// ─── Cycle 5: 링크 정확성 ─────────────────────────────────────
describe('링크 정확성', () => {
  it('자식 아이템의 href가 올바르다', async () => {
    const user = userEvent.setup()
    renderLayout()
    const nav = screen.getAllByRole('navigation')[0]

    await user.click(within(nav).getByRole('button', { name: /nav\.decksCards/ }))
    expect(within(nav).getByText('nav.decks').closest('a')).toHaveAttribute('href', '/decks')
    expect(within(nav).getByText('nav.cards').closest('a')).toHaveAttribute('href', '/templates')
  })

  it('데스크톱 자식 클릭 시 드롭다운이 닫힌다', async () => {
    const user = userEvent.setup()
    renderLayout()
    const nav = screen.getAllByRole('navigation')[0]

    await user.click(within(nav).getByRole('button', { name: /nav\.decksCards/ }))
    await user.click(within(nav).getByText('nav.decks'))

    expect(within(nav).queryByText('nav.cards')).not.toBeInTheDocument()
  })
})

// ─── Cycle 6: 엣지 케이스 ─────────────────────────────────────
describe('엣지 케이스', () => {
  it('데스크톱과 모바일 그룹 상태가 독립적이다', async () => {
    const user = userEvent.setup()
    renderLayout()

    // 데스크톱에서 덱/카드 열기
    const desktopNav = screen.getAllByRole('navigation')[0]
    await user.click(within(desktopNav).getByRole('button', { name: /nav\.decksCards/ }))
    expect(within(desktopNav).getByText('nav.decks')).toBeInTheDocument()

    // 모바일 메뉴 열기
    await user.click(screen.getByRole('button', { name: /menu/ }))
    const mobileNav = screen.getAllByRole('navigation')[1]

    // 모바일에서는 덱/카드 자식이 안 보여야 함 (독립 상태)
    expect(within(mobileNav).queryByText('nav.decks')).not.toBeInTheDocument()
  })

  it('그룹 버튼이 button 엘리먼트다', () => {
    renderLayout()
    const nav = screen.getAllByRole('navigation')[0]

    const deckBtn = within(nav).getByRole('button', { name: /nav\.decksCards/ })
    expect(deckBtn.tagName).toBe('BUTTON')
  })

  it('ChevronDown 아이콘이 그룹 버튼에 렌더된다', () => {
    renderLayout()
    const nav = screen.getAllByRole('navigation')[0]

    const deckBtn = within(nav).getByRole('button', { name: /nav\.decksCards/ })
    // lucide-react의 ChevronDown은 svg로 렌더됨
    expect(deckBtn.querySelector('svg')).toBeInTheDocument()
  })
})
