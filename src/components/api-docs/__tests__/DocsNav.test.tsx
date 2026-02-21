import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DocsNav } from '../DocsNav'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

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
    expect(screen.getByText('getStarted')).toBeInTheDocument()
  })

  it('navigates to / when logo is clicked', async () => {
    const user = userEvent.setup()
    renderNav()
    await user.click(screen.getByText('ReeeeecallStudy'))
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })
})
