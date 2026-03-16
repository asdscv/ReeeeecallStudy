import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { ResetPasswordPage } from '../ResetPasswordPage'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// ─── Mocks ──────────────────────────────────────────────────
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const mockUpdatePassword = vi.fn()
let mockSession: unknown = { user: { id: 'u1' }, access_token: 'tok' }

vi.mock('../../../stores/auth-store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ updatePassword: mockUpdatePassword, session: mockSession }),
}))

const renderPage = () =>
  render(
    <MemoryRouter>
      <ResetPasswordPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockSession = { user: { id: 'u1' }, access_token: 'tok' }
})

// ─── Logo link ──────────────────────────────────────────────
describe('Logo link', () => {
  it('should have favicon wrapped in a link to /', () => {
    renderPage()
    const link = screen.getByRole('link', { name: /landing/i })
    expect(link).toHaveAttribute('href', '/')
  })
})

// ─── Session guard ──────────────────────────────────────────
describe('Session guard', () => {
  it('should redirect to /auth/login when session is null', () => {
    mockSession = null
    renderPage()

    expect(mockNavigate).toHaveBeenCalledWith('/auth/login', { replace: true })
    expect(screen.queryByText('resetPassword.title')).not.toBeInTheDocument()
  })

  it('should render form when session exists', () => {
    renderPage()

    expect(mockNavigate).not.toHaveBeenCalled()
    expect(screen.getByText('resetPassword.title')).toBeInTheDocument()
  })
})

// ─── Rendering ──────────────────────────────────────────────
describe('Rendering', () => {
  it('should render the reset password form', () => {
    renderPage()
    expect(screen.getByText('resetPassword.title')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('resetPassword.newPasswordPlaceholder')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('resetPassword.confirmPasswordPlaceholder')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'resetPassword.changeButton' })).toBeInTheDocument()
  })

  it('should disable submit when fields are empty', () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'resetPassword.changeButton' })).toBeDisabled()
  })
})

// ─── Validation ─────────────────────────────────────────────
describe('Validation', () => {
  it('should show error when password is less than 6 characters', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText('resetPassword.newPasswordPlaceholder'), '123')
    await user.type(screen.getByPlaceholderText('resetPassword.confirmPasswordPlaceholder'), '123')
    await user.click(screen.getByRole('button', { name: 'resetPassword.changeButton' }))

    expect(screen.getByText('resetPassword.passwordTooShort')).toBeInTheDocument()
    expect(mockUpdatePassword).not.toHaveBeenCalled()
  })

  it('should show error when passwords do not match', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText('resetPassword.newPasswordPlaceholder'), 'pass123')
    await user.type(screen.getByPlaceholderText('resetPassword.confirmPasswordPlaceholder'), 'pass456')
    await user.click(screen.getByRole('button', { name: 'resetPassword.changeButton' }))

    expect(screen.getByText('resetPassword.passwordMismatch')).toBeInTheDocument()
    expect(mockUpdatePassword).not.toHaveBeenCalled()
  })
})

// ─── Submission ─────────────────────────────────────────────
describe('Submission', () => {
  it('should call updatePassword and navigate on success', async () => {
    mockUpdatePassword.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText('resetPassword.newPasswordPlaceholder'), 'newpass123')
    await user.type(screen.getByPlaceholderText('resetPassword.confirmPasswordPlaceholder'), 'newpass123')
    await user.click(screen.getByRole('button', { name: 'resetPassword.changeButton' }))

    expect(mockUpdatePassword).toHaveBeenCalledWith('newpass123')
    expect(toast.success).toHaveBeenCalledWith('resetPassword.success')
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true })
  })

  it('should show error on updatePassword failure', async () => {
    mockUpdatePassword.mockResolvedValue({ error: new Error('Too weak') })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText('resetPassword.newPasswordPlaceholder'), 'newpass123')
    await user.type(screen.getByPlaceholderText('resetPassword.confirmPasswordPlaceholder'), 'newpass123')
    await user.click(screen.getByRole('button', { name: 'resetPassword.changeButton' }))

    expect(screen.getByText('Too weak')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('should show loading state during submission', async () => {
    // Make updatePassword hang
    mockUpdatePassword.mockImplementation(
      () => new Promise(() => {}),
    )
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText('resetPassword.newPasswordPlaceholder'), 'newpass123')
    await user.type(screen.getByPlaceholderText('resetPassword.confirmPasswordPlaceholder'), 'newpass123')
    await user.click(screen.getByRole('button', { name: 'resetPassword.changeButton' }))

    expect(screen.getByText('resetPassword.changing')).toBeInTheDocument()
  })
})

// ─── Edge cases ─────────────────────────────────────────────
describe('Edge cases', () => {
  it('should clear error when resubmitting', async () => {
    mockUpdatePassword
      .mockResolvedValueOnce({ error: new Error('Too weak') })
      .mockResolvedValueOnce({ error: null })

    const user = userEvent.setup()
    renderPage()

    // First attempt — error
    await user.type(screen.getByPlaceholderText('resetPassword.newPasswordPlaceholder'), 'newpass123')
    await user.type(screen.getByPlaceholderText('resetPassword.confirmPasswordPlaceholder'), 'newpass123')
    await user.click(screen.getByRole('button', { name: 'resetPassword.changeButton' }))
    expect(screen.getByText('Too weak')).toBeInTheDocument()

    // Second attempt — success
    await user.click(screen.getByRole('button', { name: 'resetPassword.changeButton' }))
    expect(screen.queryByText('Too weak')).not.toBeInTheDocument()
  })
})
