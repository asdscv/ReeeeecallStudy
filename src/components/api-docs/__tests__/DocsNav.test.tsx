import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocsNav } from '../DocsNav'

vi.mock('lucide-react', () => ({
  ArrowRight: () => <span data-testid="arrow-right" />,
}))

function renderNav() {
  return render(
    <MemoryRouter>
      <DocsNav />
    </MemoryRouter>,
  )
}

describe('DocsNav', () => {
  it('renders logo text', () => {
    renderNav()
    expect(screen.getByText('ReeeeecallStudy')).toBeInTheDocument()
  })

  it('renders favicon image', () => {
    renderNav()
    const img = screen.getByAltText('')
    expect(img).toHaveAttribute('src', '/favicon.png')
  })

  it('renders "시작하기" button', () => {
    renderNav()
    expect(screen.getByText('시작하기')).toBeInTheDocument()
  })
})
