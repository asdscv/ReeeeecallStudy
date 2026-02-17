import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PublicApiDocsPage } from '../PublicApiDocsPage'

vi.mock('lucide-react', () => ({
  Search: () => <span data-testid="search-icon" />,
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronUp: () => <span data-testid="chevron-up" />,
  ArrowRight: () => <span data-testid="arrow-right" />,
  Copy: () => <span data-testid="copy-icon" />,
  Check: () => <span data-testid="check-icon" />,
  BookOpen: () => <span data-testid="book-icon" />,
  ChevronRight: () => <span data-testid="chevron-right" />,
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <PublicApiDocsPage />
    </MemoryRouter>,
  )
}

describe('PublicApiDocsPage', () => {
  it('renders page title', () => {
    renderPage()
    expect(screen.getByText('API 문서')).toBeInTheDocument()
  })

  it('renders DocsNav with logo', () => {
    renderPage()
    const logos = screen.getAllByText('ReeeeecallStudy')
    expect(logos.length).toBeGreaterThanOrEqual(1)
  })

  it('renders "시작하기" button from DocsNav', () => {
    renderPage()
    expect(screen.getByText('시작하기')).toBeInTheDocument()
  })

  it('renders public variant QuickStartBanner (회원가입 link)', () => {
    renderPage()
    expect(screen.getByText('회원가입')).toBeInTheDocument()
  })

  it('renders DocsFooter with copyright', () => {
    renderPage()
    expect(screen.getByText(/All rights reserved/)).toBeInTheDocument()
  })

  it('renders search input', () => {
    renderPage()
    expect(screen.getByPlaceholderText(/검색/)).toBeInTheDocument()
  })

  it('renders footer links', () => {
    renderPage()
    expect(screen.getByText('홈')).toBeInTheDocument()
    expect(screen.getByText('로그인')).toBeInTheDocument()
  })
})
