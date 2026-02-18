import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LoginPage } from '../LoginPage'

// ─── Mocks ──────────────────────────────────────────────────
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const mockSignIn = vi.fn()
const mockSignUp = vi.fn()
const mockResetPassword = vi.fn()

vi.mock('../../../stores/auth-store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      signIn: mockSignIn,
      signUp: mockSignUp,
      resetPassword: mockResetPassword,
    }),
}))

const renderLogin = () =>
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Logo link ──────────────────────────────────────────────
describe('Logo link', () => {
  it('should have logo wrapped in a link to /landing', () => {
    renderLogin()
    const link = screen.getByRole('link', { name: /ReeeeecallStudy/i })
    expect(link).toHaveAttribute('href', '/landing')
  })
})

// ─── Login mode ─────────────────────────────────────────────
describe('Login mode', () => {
  it('should render login form by default', () => {
    renderLogin()
    expect(screen.getByRole('button', { name: 'loginButton' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('your@email.com')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('passwordPlaceholder')).toBeInTheDocument()
  })

  it('should disable submit when fields are empty', () => {
    renderLogin()
    const btn = screen.getByRole('button', { name: 'loginButton' })
    expect(btn).toBeDisabled()
  })

  it('should call signIn and navigate on success', async () => {
    mockSignIn.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('passwordPlaceholder'), 'pass123')
    await user.click(screen.getByRole('button', { name: 'loginButton' }))

    expect(mockSignIn).toHaveBeenCalledWith('a@b.com', 'pass123')
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true })
  })

  it('should show error message on signIn failure', async () => {
    mockSignIn.mockResolvedValue({ error: new Error('Invalid credentials') })
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('passwordPlaceholder'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'loginButton' }))

    expect(screen.getByText('Invalid credentials')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('should show "비밀번호를 잊으셨나요?" link', () => {
    renderLogin()
    expect(screen.getByText('forgotPasswordLink')).toBeInTheDocument()
  })

  it('should switch to signup mode', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByText('signup'))

    // In signup mode, text changes to "이미 계정이 있으신가요?"
    expect(screen.getByText('alreadyHaveAccount')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'signupButton' })).toBeInTheDocument()
  })
})

// ─── Signup mode ────────────────────────────────────────────
describe('Signup mode', () => {
  const goToSignup = async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByText('signup'))
    return user
  }

  it('should show signup form after switching', async () => {
    await goToSignup()
    // Submit button should say 회원가입
    const buttons = screen.getAllByText('signupButton')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
  })

  it('should validate password length < 6', async () => {
    mockSignUp.mockResolvedValue({ error: null })
    const user = await goToSignup()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('passwordPlaceholder'), '123')

    // Submit button — find the one that's a submit type
    const submitBtn = screen.getByRole('button', { name: 'signupButton' })
    await user.click(submitBtn)

    expect(screen.getByText('resetPassword.passwordTooShort')).toBeInTheDocument()
    expect(mockSignUp).not.toHaveBeenCalled()
  })

  it('should call signUp and show success message', async () => {
    mockSignUp.mockResolvedValue({ error: null })
    const user = await goToSignup()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('passwordPlaceholder'), 'pass123')
    await user.click(screen.getByRole('button', { name: 'signupButton' }))

    expect(mockSignUp).toHaveBeenCalledWith('a@b.com', 'pass123')
    expect(screen.getByText('emailVerification.title')).toBeInTheDocument()
  })

  it('should show error on signUp failure', async () => {
    mockSignUp.mockResolvedValue({ error: new Error('Email taken') })
    const user = await goToSignup()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('passwordPlaceholder'), 'pass123')
    await user.click(screen.getByRole('button', { name: 'signupButton' }))

    expect(screen.getByText('Email taken')).toBeInTheDocument()
  })

  it('should switch back to login with "로그인" link', async () => {
    const user = await goToSignup()
    await user.click(screen.getByText('login'))
    // Should now show login form
    expect(screen.getByText('forgotPasswordLink')).toBeInTheDocument()
  })
})

// ─── Forgot password mode ───────────────────────────────────
describe('Forgot password mode', () => {
  const goToForgot = async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByText('forgotPasswordLink'))
    return user
  }

  it('should show forgot form without password input', async () => {
    await goToForgot()

    expect(screen.getByPlaceholderText('your@email.com')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('passwordPlaceholder')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'sendResetLink' })).toBeInTheDocument()
  })

  it('should call resetPassword and show success message', async () => {
    mockResetPassword.mockResolvedValue({ error: null })
    const user = await goToForgot()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.click(screen.getByRole('button', { name: 'sendResetLink' }))

    expect(mockResetPassword).toHaveBeenCalledWith('a@b.com')
    expect(screen.getByText('emailVerification.title')).toBeInTheDocument()
  })

  it('should show error on resetPassword failure', async () => {
    mockResetPassword.mockResolvedValue({ error: new Error('Rate limit') })
    const user = await goToForgot()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.click(screen.getByRole('button', { name: 'sendResetLink' }))

    expect(screen.getByText('Rate limit')).toBeInTheDocument()
  })

  it('should switch back to login with "로그인으로 돌아가기"', async () => {
    const user = await goToForgot()
    await user.click(screen.getByText('backToLogin'))
    expect(screen.getByText('forgotPasswordLink')).toBeInTheDocument()
  })
})

// ─── Success message view ───────────────────────────────────
describe('Success message view', () => {
  it('should show "로그인 페이지로 돌아가기" button and switch back', async () => {
    mockSignUp.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderLogin()

    // Go to signup and submit
    await user.click(screen.getByText('signup'))
    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('passwordPlaceholder'), 'pass123')
    await user.click(screen.getByRole('button', { name: 'signupButton' }))

    // Now in success view
    expect(screen.getByText('emailVerification.title')).toBeInTheDocument()
    expect(screen.getByText('a@b.com')).toBeInTheDocument()

    // Click back to login
    await user.click(screen.getByText('emailVerification.backToLogin'))
    expect(screen.getByPlaceholderText('your@email.com')).toBeInTheDocument()
  })
})
