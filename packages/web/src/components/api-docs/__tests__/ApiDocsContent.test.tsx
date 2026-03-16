import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ApiDocsContent } from '../ApiDocsContent'
import { API_DOCS_SECTIONS } from '../../../lib/api-docs-content'

vi.mock('lucide-react', () => ({
  Search: () => <span data-testid="search-icon" />,
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronUp: () => <span data-testid="chevron-up" />,
  Copy: () => <span data-testid="copy-icon" />,
  Check: () => <span data-testid="check-icon" />,
  BookOpen: () => <span data-testid="book-icon" />,
  ChevronRight: () => <span data-testid="chevron-right" />,
}))

function renderContent(variant: 'public' | 'authenticated' = 'authenticated') {
  return render(
    <MemoryRouter>
      <ApiDocsContent variant={variant} />
    </MemoryRouter>,
  )
}

describe('ApiDocsContent', () => {
  it('renders search input', () => {
    renderContent()
    expect(screen.getByPlaceholderText('searchPlaceholder')).toBeInTheDocument()
  })

  it('renders table of contents with all section titles', () => {
    renderContent()
    for (const section of API_DOCS_SECTIONS) {
      const elements = screen.getAllByText(section.title)
      expect(elements.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('renders section icons', () => {
    renderContent()
    for (const section of API_DOCS_SECTIONS) {
      const icons = screen.getAllByText(section.icon)
      expect(icons.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('filters sections when typing in search', () => {
    renderContent()
    const input = screen.getByPlaceholderText('searchPlaceholder')
    // Search for a term that appears in a section title i18n key
    fireEvent.change(input, { target: { value: 'authentication' } })
    expect(screen.getByText('sections.authentication.title')).toBeInTheDocument()
  })

  it('shows no results message when search has no matches', () => {
    renderContent()
    const input = screen.getByPlaceholderText('searchPlaceholder')
    fireEvent.change(input, { target: { value: 'nonexistentsearchxyz99' } })
    expect(screen.getByText(/noResults/)).toBeInTheDocument()
  })

  it('hides TOC when searching', () => {
    renderContent()
    expect(screen.getByText('tableOfContents')).toBeInTheDocument()

    const input = screen.getByPlaceholderText('searchPlaceholder')
    fireEvent.change(input, { target: { value: 'authentication' } })
    expect(screen.queryByText('tableOfContents')).not.toBeInTheDocument()
  })

  it('passes authenticated variant to QuickStartBanner', () => {
    renderContent('authenticated')
    expect(screen.getByText('quickStart.settingsPage')).toBeInTheDocument()
  })

  it('passes public variant to QuickStartBanner', () => {
    renderContent('public')
    expect(screen.getByText('quickStart.signup')).toBeInTheDocument()
  })

  it('displays endpoint method badges when section is expanded by search', () => {
    renderContent()
    const input = screen.getByPlaceholderText('searchPlaceholder')
    // Search for endpoint path to expand the section
    fireEvent.change(input, { target: { value: '/decks' } })
    const getBadges = screen.getAllByText('GET')
    expect(getBadges.length).toBeGreaterThan(0)
  })
})
