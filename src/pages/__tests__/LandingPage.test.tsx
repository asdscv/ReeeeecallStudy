import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LandingPage } from '../LandingPage'

vi.mock('../../stores/content-store', () => ({
  useContentStore: () => ({
    items: [],
    listLoading: false,
    fetchContents: vi.fn(),
  }),
}))

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  )
}

describe('LandingNav', () => {
  it('should render Insights link pointing to /insight', () => {
    renderLanding()
    // t('nav.blog', 'Insights') returns 'Insights' in test (empty resources, defaultValue)
    const links = screen.getAllByRole('link', { name: 'Insights' })
    // nav + footer both have Insights link; nav is first
    expect(links[0]).toHaveAttribute('href', '/insight')
  })

  it('should render Login link pointing to /auth/login', () => {
    renderLanding()
    const links = screen.getAllByRole('link', { name: 'Log in' })
    expect(links[0]).toHaveAttribute('href', '/auth/login')
  })

  it('should render Get Started button pointing to /auth/login', () => {
    renderLanding()
    const links = screen.getAllByRole('link', { name: 'Get Started' })
    expect(links[0]).toHaveAttribute('href', '/auth/login')
  })
})
