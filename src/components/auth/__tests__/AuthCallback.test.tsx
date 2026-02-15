import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AuthCallback } from '../AuthCallback'

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

const renderCallback = () =>
  render(
    <MemoryRouter>
      <AuthCallback />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  // Reset hash
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, hash: '' },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── Loading state ──────────────────────────────────────────
describe('Loading state', () => {
  it('should show loading spinner initially', () => {
    renderCallback()
    expect(screen.getByText('처리 중...')).toBeInTheDocument()
  })

  it('should subscribe to auth state changes', () => {
    renderCallback()
    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1)
  })
})

// ─── Auth state change events ───────────────────────────────
describe('Auth state change events', () => {
  it('should navigate to / on SIGNED_IN', () => {
    let callback: (event: string) => void = () => {}
    mockOnAuthStateChange.mockImplementation((cb: (event: string) => void) => {
      callback = cb
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } }
    })

    renderCallback()
    act(() => callback('SIGNED_IN'))

    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true })
  })

  it('should navigate to /auth/reset-password on PASSWORD_RECOVERY', () => {
    let callback: (event: string) => void = () => {}
    mockOnAuthStateChange.mockImplementation((cb: (event: string) => void) => {
      callback = cb
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } }
    })

    renderCallback()
    act(() => callback('PASSWORD_RECOVERY'))

    expect(mockNavigate).toHaveBeenCalledWith('/auth/reset-password', { replace: true })
  })
})

// ─── Hash error handling ────────────────────────────────────
describe('Hash error handling', () => {
  it('should show otp_expired error from hash', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, hash: '#error_code=otp_expired&error_description=OTP+expired' },
    })

    renderCallback()

    expect(screen.getByText('링크가 만료되었습니다. 다시 시도해주세요.')).toBeInTheDocument()
  })

  it('should show access_denied error from hash', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, hash: '#error_code=access_denied&error_description=Access+denied' },
    })

    renderCallback()

    expect(screen.getByText('접근이 거부되었습니다. 다시 시도해주세요.')).toBeInTheDocument()
  })

  it('should show fallback error description from hash', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, hash: '#error_code=unknown_error&error_description=Something+went+wrong' },
    })

    renderCallback()

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('should show generic error when no description', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, hash: '#error_code=unknown_error' },
    })

    renderCallback()

    expect(screen.getByText('인증에 실패했습니다.')).toBeInTheDocument()
  })
})

// ─── Timeout ────────────────────────────────────────────────
describe('Timeout', () => {
  it('should show timeout error after 10 seconds', () => {
    renderCallback()

    act(() => {
      vi.advanceTimersByTime(10000)
    })

    expect(screen.getByText('처리 시간이 초과되었습니다. 다시 시도해주세요.')).toBeInTheDocument()
  })

  it('should not show timeout before 10 seconds', () => {
    renderCallback()

    act(() => {
      vi.advanceTimersByTime(9999)
    })

    expect(screen.queryByText('처리 시간이 초과되었습니다. 다시 시도해주세요.')).not.toBeInTheDocument()
    expect(screen.getByText('처리 중...')).toBeInTheDocument()
  })
})

// ─── Error view ─────────────────────────────────────────────
describe('Error view', () => {
  it('should show "로그인 페이지로 돌아가기" button and navigate on click', async () => {
    vi.useRealTimers()

    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, hash: '#error_code=otp_expired' },
    })

    const user = userEvent.setup()
    renderCallback()

    const btn = screen.getByRole('button', { name: '로그인 페이지로 돌아가기' })
    await user.click(btn)

    expect(mockNavigate).toHaveBeenCalledWith('/auth/login', { replace: true })
  })
})
