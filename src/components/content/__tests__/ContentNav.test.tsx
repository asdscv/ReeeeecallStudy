import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ContentNav } from '../ContentNav'

function renderNav() {
  return render(
    <MemoryRouter>
      <ContentNav />
    </MemoryRouter>,
  )
}

describe('ContentNav', () => {
  it('should render logo link pointing to /landing', () => {
    renderNav()
    const link = screen.getByRole('link', { name: /ReeeeecallStudy/i })
    expect(link).toHaveAttribute('href', '/landing')
  })
})
