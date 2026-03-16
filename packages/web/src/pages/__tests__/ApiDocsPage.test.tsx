import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ApiDocsPage } from '../ApiDocsPage'
import { API_DOCS_SECTIONS } from '../../lib/api-docs-content'

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Search: () => <span data-testid="search-icon" />,
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronUp: () => <span data-testid="chevron-up" />,
  ArrowLeft: () => <span data-testid="arrow-left" />,
  Copy: () => <span data-testid="copy-icon" />,
  Check: () => <span data-testid="check-icon" />,
  BookOpen: () => <span data-testid="book-icon" />,
  ChevronRight: () => <span data-testid="chevron-right" />,
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <ApiDocsPage />
    </MemoryRouter>,
  )
}

describe('ApiDocsPage', () => {
  it('renders the page title', () => {
    renderPage()
    expect(screen.getByText('title')).toBeInTheDocument()
  })

  it('renders subtitle', () => {
    renderPage()
    expect(screen.getByText('subtitle')).toBeInTheDocument()
  })

  it('renders search input', () => {
    renderPage()
    const input = screen.getByPlaceholderText('searchPlaceholder')
    expect(input).toBeInTheDocument()
  })

  it('renders table of contents with all section titles', () => {
    renderPage()
    for (const section of API_DOCS_SECTIONS) {
      // Titles appear in both TOC and section cards
      const elements = screen.getAllByText(section.title)
      expect(elements.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('renders section icons', () => {
    renderPage()
    for (const section of API_DOCS_SECTIONS) {
      // Icons appear in both TOC and section cards
      const icons = screen.getAllByText(section.icon)
      expect(icons.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('filters sections when typing in search', () => {
    renderPage()
    const input = screen.getByPlaceholderText('searchPlaceholder')
    // Search for a term that appears in a section title i18n key
    fireEvent.change(input, { target: { value: 'authentication' } })

    // Authentication section should be visible (title is the i18n key)
    expect(screen.getByText('sections.authentication.title')).toBeInTheDocument()
  })

  it('shows no results message when search has no matches', () => {
    renderPage()
    const input = screen.getByPlaceholderText('searchPlaceholder')
    fireEvent.change(input, { target: { value: 'nonexistentsearchxyz99' } })

    expect(screen.getByText(/noResults/)).toBeInTheDocument()
  })

  it('displays endpoint method badges when section is expanded by search', () => {
    renderPage()
    const input = screen.getByPlaceholderText('searchPlaceholder')
    // Search for endpoint path to expand the section
    fireEvent.change(input, { target: { value: '/decks' } })

    const getBadges = screen.getAllByText('GET')
    expect(getBadges.length).toBeGreaterThan(0)
  })

  it('displays endpoint paths when section is expanded by search', () => {
    renderPage()
    const input = screen.getByPlaceholderText('searchPlaceholder')
    fireEvent.change(input, { target: { value: '/decks' } })

    // Endpoint paths are visible in expanded state
    const pathElements = screen.getAllByText('/decks')
    expect(pathElements.length).toBeGreaterThan(0)
  })

  it('renders back button', () => {
    renderPage()
    expect(screen.getByTestId('arrow-left')).toBeInTheDocument()
  })
})
