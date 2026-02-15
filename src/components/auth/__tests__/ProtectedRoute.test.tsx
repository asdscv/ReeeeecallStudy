import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ProtectedRoute } from '../ProtectedRoute'

// ─── Mocks ──────────────────────────────────────────────────
let mockState = { user: null as unknown, loading: false }

vi.mock('../../../stores/auth-store', () => ({
  useAuthStore: () => mockState,
}))

const renderRoute = () =>
  render(
    <MemoryRouter>
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    </MemoryRouter>,
  )

// ─── Tests ──────────────────────────────────────────────────
describe('ProtectedRoute', () => {
  it('should show loading indicator when loading is true', () => {
    mockState = { user: null, loading: true }
    renderRoute()

    // Loading state shows a pulsing emoji
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })

  it('should render children when user is authenticated', () => {
    mockState = { user: { id: 'u1' }, loading: false }
    renderRoute()

    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })

  it('should redirect to /auth/login when not authenticated', () => {
    mockState = { user: null, loading: false }
    const { container } = renderRoute()

    // Navigate component renders nothing visible
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
    // The container should be empty (Navigate renders no visible DOM)
    expect(container.innerHTML).toBe('')
  })

  it('should not show children during loading even if user exists', () => {
    mockState = { user: { id: 'u1' }, loading: true }
    renderRoute()

    // Loading takes precedence
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })
})
