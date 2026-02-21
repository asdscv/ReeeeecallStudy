import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AuthCallback, _setCapturedHash } from '../AuthCallback'

// ─── Mocks ──────────────────────────────────────────────────
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const mockUnsubscribe = vi.fn()
const mockOnAuthStateChange = vi.fn((_cb: (...args: unknown[]) => void) => ({
  data: { subscription: { unsubscribe: mockUnsubscribe } },
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(args[0] as (...a: unknown[]) => void),
    },
  },
}))

type AuthCallback = (event: string, session: unknown) => void

const fakeSession = { user: { id: 'u1' }, access_token: 'tok' }

const renderCallback = () =>
  render(
    <MemoryRouter>
      <AuthCallback />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  // Reset captured hash to empty (no hash)
  _setCapturedHash('')
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── Loading state ──────────────────────────────────────────
describe('Loading state', () => {
  it('should show loading spinner initially', () => {
    renderCallback()
    expect(screen.getByText('callback.processing')).toBeInTheDocument()
  })

  it('should subscribe to auth state changes', () => {
    renderCallback()
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1)
  })
})

// ─── Auth state change events ───────────────────────────────
describe('Auth state change events', () => {
  it('should navigate to /dashboard on SIGNED_IN', () => {
    let callback: AuthCallback = () => {}
    mockOnAuthStateChange.mockImplementation((cb: AuthCallback) => {
      callback = cb
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } }
    })

    renderCallback()
    act(() => callback('SIGNED_IN', fakeSession))

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true })
  })

  it('should navigate to /auth/reset-password on PASSWORD_RECOVERY', () => {
    let callback: AuthCallback = () => {}
    mockOnAuthStateChange.mockImplementation((cb: AuthCallback) => {
      callback = cb
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } }
    })

    renderCallback()
    act(() => callback('PASSWORD_RECOVERY', fakeSession))

    expect(mockNavigate).toHaveBeenCalledWith('/auth/reset-password', { replace: true })
  })
})

// ─── Recovery hash type handling ────────────────────────────
describe('Recovery hash type handling', () => {
  it('should navigate to /auth/reset-password when hash contains type=recovery, even on SIGNED_IN event', () => {
    _setCapturedHash('#access_token=abc&type=recovery')

    let callback: AuthCallback = () => {}
    mockOnAuthStateChange.mockImplementation((cb: AuthCallback) => {
      callback = cb
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } }
    })

    renderCallback()
    act(() => callback('SIGNED_IN', fakeSession))

    // Even though event is SIGNED_IN, hash type=recovery should take precedence
    expect(mockNavigate).toHaveBeenCalledWith('/auth/reset-password', { replace: true })
  })

  it('should navigate to /dashboard on SIGNED_IN when hash type is not recovery', () => {
    _setCapturedHash('#access_token=abc&type=signup')

    let callback: AuthCallback = () => {}
    mockOnAuthStateChange.mockImplementation((cb: AuthCallback) => {
      callback = cb
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } }
    })

    renderCallback()
    act(() => callback('SIGNED_IN', fakeSession))

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true })
  })

  it('should navigate to /auth/reset-password on INITIAL_SESSION with recovery hash AND valid session', () => {
    _setCapturedHash('#access_token=abc&type=recovery')

    let callback: AuthCallback = () => {}
    mockOnAuthStateChange.mockImplementation((cb: AuthCallback) => {
      callback = cb
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } }
    })

    renderCallback()
    act(() => callback('INITIAL_SESSION', fakeSession))

    expect(mockNavigate).toHaveBeenCalledWith('/auth/reset-password', { replace: true })
  })

  it('should NOT navigate on INITIAL_SESSION with recovery hash but NULL session (race condition guard)', () => {
    _setCapturedHash('#access_token=abc&type=recovery')

    let callback: AuthCallback = () => {}
    mockOnAuthStateChange.mockImplementation((cb: AuthCallback) => {
      callback = cb
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } }
    })

    renderCallback()
    act(() => callback('INITIAL_SESSION', null))

    // Must NOT navigate — session doesn't exist yet, wait for SIGNED_IN/PASSWORD_RECOVERY
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('should navigate on SIGNED_IN after INITIAL_SESSION with null session was skipped', () => {
    _setCapturedHash('#access_token=abc&type=recovery')

    let callback: AuthCallback = () => {}
    mockOnAuthStateChange.mockImplementation((cb: AuthCallback) => {
      callback = cb
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } }
    })

    renderCallback()

    // INITIAL_SESSION fires first with null session — skipped
    act(() => callback('INITIAL_SESSION', null))
    expect(mockNavigate).not.toHaveBeenCalled()

    // Then SIGNED_IN fires with valid session — should navigate
    act(() => callback('SIGNED_IN', fakeSession))
    expect(mockNavigate).toHaveBeenCalledWith('/auth/reset-password', { replace: true })
    expect(mockNavigate).toHaveBeenCalledTimes(1)
  })

  it('should NOT navigate on INITIAL_SESSION without recovery hash', () => {
    _setCapturedHash('#access_token=abc&type=signup')

    let callback: AuthCallback = () => {}
    mockOnAuthStateChange.mockImplementation((cb: AuthCallback) => {
      callback = cb
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } }
    })

    renderCallback()
    act(() => callback('INITIAL_SESSION', fakeSession))

    expect(mockNavigate).not.toHaveBeenCalled()
  })
})

// ─── Double navigation prevention ───────────────────────────
describe('Double navigation prevention', () => {
  it('should only navigate once when multiple events fire', () => {
    _setCapturedHash('#access_token=abc&type=recovery')

    let callback: AuthCallback = () => {}
    mockOnAuthStateChange.mockImplementation((cb: AuthCallback) => {
      callback = cb
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } }
    })

    renderCallback()

    // Fire multiple events
    act(() => {
      callback('SIGNED_IN', fakeSession)
      callback('PASSWORD_RECOVERY', fakeSession)
    })

    // Should only navigate once
    expect(mockNavigate).toHaveBeenCalledTimes(1)
    expect(mockNavigate).toHaveBeenCalledWith('/auth/reset-password', { replace: true })
  })

  it('should not show timeout error after successful navigation', () => {
    let callback: AuthCallback = () => {}
    mockOnAuthStateChange.mockImplementation((cb: AuthCallback) => {
      callback = cb
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } }
    })

    renderCallback()
    act(() => callback('SIGNED_IN', fakeSession))

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true })

    // Advance past timeout
    act(() => {
      vi.advanceTimersByTime(10000)
    })

    // Should not show timeout error since navigation already happened
    expect(screen.queryByText('callback.errors.timeout')).not.toBeInTheDocument()
  })
})

// ─── Hash error handling ────────────────────────────────────
describe('Hash error handling', () => {
  it('should show otp_expired error from hash', () => {
    _setCapturedHash('#error_code=otp_expired&error_description=OTP+expired')

    renderCallback()

    // In test env, t() returns key, but with defaultValue it shows the error description
    expect(screen.getByText('OTP expired')).toBeInTheDocument()
  })

  it('should show access_denied error from hash', () => {
    _setCapturedHash('#error_code=access_denied&error_description=Access+denied')

    renderCallback()

    // In test env, t() returns key, but with defaultValue it shows the error description
    expect(screen.getByText('Access denied')).toBeInTheDocument()
  })

  it('should show fallback error description from hash', () => {
    _setCapturedHash('#error_code=unknown_error&error_description=Something+went+wrong')

    renderCallback()

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('should show generic error when no description', () => {
    _setCapturedHash('#error_code=unknown_error')

    renderCallback()

    expect(screen.getByText('callback.errors.default')).toBeInTheDocument()
  })
})

// ─── Timeout ────────────────────────────────────────────────
describe('Timeout', () => {
  it('should show timeout error after 10 seconds', () => {
    renderCallback()

    act(() => {
      vi.advanceTimersByTime(10000)
    })

    expect(screen.getByText('callback.errors.timeout')).toBeInTheDocument()
  })

  it('should not show timeout before 10 seconds', () => {
    renderCallback()

    act(() => {
      vi.advanceTimersByTime(9999)
    })

    expect(screen.queryByText('callback.errors.timeout')).not.toBeInTheDocument()
    expect(screen.getByText('callback.processing')).toBeInTheDocument()
  })
})

// ─── Error view ─────────────────────────────────────────────
describe('Error view', () => {
  it('should show "로그인 페이지로 돌아가기" button and navigate on click', async () => {
    vi.useRealTimers()

    _setCapturedHash('#error_code=otp_expired')

    const user = userEvent.setup()
    renderCallback()

    const btn = screen.getByRole('button', { name: 'callback.backToLogin' })
    await user.click(btn)

    expect(mockNavigate).toHaveBeenCalledWith('/auth/login', { replace: true })
  })
})
