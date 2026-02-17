import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QuickStartBanner } from '../QuickStartBanner'

function renderBanner(variant: 'public' | 'authenticated') {
  return render(
    <MemoryRouter>
      <QuickStartBanner variant={variant} />
    </MemoryRouter>,
  )
}

describe('QuickStartBanner', () => {
  it('renders "빠른 시작" heading', () => {
    renderBanner('authenticated')
    expect(screen.getByText('빠른 시작')).toBeInTheDocument()
  })

  it('renders settings link for authenticated variant', () => {
    renderBanner('authenticated')
    const link = screen.getByText('설정 페이지')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', '/settings')
  })

  it('renders signup link for public variant', () => {
    renderBanner('public')
    const link = screen.getByText('회원가입')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', '/auth/login')
  })

  it('renders shared step 2 (Authorization header)', () => {
    renderBanner('public')
    expect(screen.getByText(/Authorization: Bearer rc_/)).toBeInTheDocument()
  })

  it('renders shared step 3', () => {
    renderBanner('authenticated')
    expect(screen.getByText(/엔드포인트를 참고/)).toBeInTheDocument()
  })
})
