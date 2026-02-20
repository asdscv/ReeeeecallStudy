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
const mockCheckNicknameAvailability = vi.fn()

vi.mock('../../../stores/auth-store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      signIn: mockSignIn,
      signUp: mockSignUp,
      resetPassword: mockResetPassword,
      checkNicknameAvailability: mockCheckNicknameAvailability,
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
    const buttons = screen.getAllByText('signupButton')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
  })

  it('should show nickname check button', async () => {
    await goToSignup()
    expect(screen.getByRole('button', { name: 'checkAvailability' })).toBeInTheDocument()
  })

  it('should show confirm password field', async () => {
    await goToSignup()
    expect(screen.getByPlaceholderText('confirmPasswordPlaceholder')).toBeInTheDocument()
  })

  it('should block signup if nickname not checked', async () => {
    mockCheckNicknameAvailability.mockResolvedValue({ available: true, error: null })
    const user = await goToSignup()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('nicknamePlaceholder'), 'TestUser')
    await user.type(screen.getByPlaceholderText('passwordPlaceholder'), 'Abcd123!')
    await user.type(screen.getByPlaceholderText('confirmPasswordPlaceholder'), 'Abcd123!')
    await user.click(screen.getByRole('button', { name: 'signupButton' }))

    expect(screen.getByText('nicknameCheckRequired')).toBeInTheDocument()
    expect(mockSignUp).not.toHaveBeenCalled()
  })

  it('should show nickname available after check', async () => {
    mockCheckNicknameAvailability.mockResolvedValue({ available: true, error: null })
    const user = await goToSignup()

    await user.type(screen.getByPlaceholderText('nicknamePlaceholder'), 'NewUser')
    await user.click(screen.getByRole('button', { name: 'checkAvailability' }))

    expect(await screen.findByTestId('nickname-available')).toBeInTheDocument()
  })

  it('should show nickname taken after check', async () => {
    mockCheckNicknameAvailability.mockResolvedValue({ available: false, error: null })
    const user = await goToSignup()

    await user.type(screen.getByPlaceholderText('nicknamePlaceholder'), 'TakenUser')
    await user.click(screen.getByRole('button', { name: 'checkAvailability' }))

    expect(await screen.findByTestId('nickname-taken')).toBeInTheDocument()
  })

  it('should reset nickname check when nickname changes', async () => {
    mockCheckNicknameAvailability.mockResolvedValue({ available: true, error: null })
    const user = await goToSignup()

    await user.type(screen.getByPlaceholderText('nicknamePlaceholder'), 'NewUser')
    await user.click(screen.getByRole('button', { name: 'checkAvailability' }))
    expect(await screen.findByTestId('nickname-available')).toBeInTheDocument()

    // Change nickname — check should reset
    await user.type(screen.getByPlaceholderText('nicknamePlaceholder'), '2')
    expect(screen.queryByTestId('nickname-available')).not.toBeInTheDocument()
  })

  it('should block signup if password fails rules', async () => {
    mockCheckNicknameAvailability.mockResolvedValue({ available: true, error: null })
    const user = await goToSignup()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('nicknamePlaceholder'), 'TestUser')
    await user.click(screen.getByRole('button', { name: 'checkAvailability' }))
    await screen.findByTestId('nickname-available')

    // Password without symbol
    await user.type(screen.getByPlaceholderText('passwordPlaceholder'), 'Abcdefg1')
    await user.type(screen.getByPlaceholderText('confirmPasswordPlaceholder'), 'Abcdefg1')
    await user.click(screen.getByRole('button', { name: 'signupButton' }))

    // Error text appears both in the rule indicator and as form error — use getAllByText
    const matches = screen.getAllByText('passwordRules.needsSymbol')
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(mockSignUp).not.toHaveBeenCalled()
  })

  it('should block signup if passwords do not match', async () => {
    mockCheckNicknameAvailability.mockResolvedValue({ available: true, error: null })
    const user = await goToSignup()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('nicknamePlaceholder'), 'TestUser')
    await user.click(screen.getByRole('button', { name: 'checkAvailability' }))
    await screen.findByTestId('nickname-available')

    await user.type(screen.getByPlaceholderText('passwordPlaceholder'), 'Abcd123!')
    await user.type(screen.getByPlaceholderText('confirmPasswordPlaceholder'), 'Abcd123?')
    await user.click(screen.getByRole('button', { name: 'signupButton' }))

    // Mismatch text appears both in real-time indicator and form error
    const matches = screen.getAllByText('passwordRules.mismatch')
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(mockSignUp).not.toHaveBeenCalled()
  })

  it('should show password rule indicator when typing password', async () => {
    const user = await goToSignup()

    await user.type(screen.getByPlaceholderText('passwordPlaceholder'), 'a')

    expect(screen.getByTestId('password-rules')).toBeInTheDocument()
  })

  it('should show real-time password mismatch warning', async () => {
    const user = await goToSignup()

    await user.type(screen.getByPlaceholderText('passwordPlaceholder'), 'Abcd123!')
    await user.type(screen.getByPlaceholderText('confirmPasswordPlaceholder'), 'Abcd123?')

    expect(screen.getByTestId('password-mismatch')).toBeInTheDocument()
  })

  it('should call signUp with valid input and show success', async () => {
    mockCheckNicknameAvailability.mockResolvedValue({ available: true, error: null })
    mockSignUp.mockResolvedValue({ error: null })
    const user = await goToSignup()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('nicknamePlaceholder'), 'TestUser')
    await user.click(screen.getByRole('button', { name: 'checkAvailability' }))
    await screen.findByTestId('nickname-available')

    await user.type(screen.getByPlaceholderText('passwordPlaceholder'), 'Abcd123!')
    await user.type(screen.getByPlaceholderText('confirmPasswordPlaceholder'), 'Abcd123!')
    await user.click(screen.getByRole('button', { name: 'signupButton' }))

    expect(mockSignUp).toHaveBeenCalledWith('a@b.com', 'Abcd123!', 'TestUser')
    expect(screen.getByText('emailVerification.title')).toBeInTheDocument()
  })

  it('should show error on signUp failure', async () => {
    mockCheckNicknameAvailability.mockResolvedValue({ available: true, error: null })
    mockSignUp.mockResolvedValue({ error: new Error('Email taken') })
    const user = await goToSignup()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('nicknamePlaceholder'), 'TestUser')
    await user.click(screen.getByRole('button', { name: 'checkAvailability' }))
    await screen.findByTestId('nickname-available')

    await user.type(screen.getByPlaceholderText('passwordPlaceholder'), 'Abcd123!')
    await user.type(screen.getByPlaceholderText('confirmPasswordPlaceholder'), 'Abcd123!')
    await user.click(screen.getByRole('button', { name: 'signupButton' }))

    expect(screen.getByText('Email taken')).toBeInTheDocument()
  })

  it('should switch back to login with "로그인" link', async () => {
    const user = await goToSignup()
    await user.click(screen.getByText('login'))
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
    mockCheckNicknameAvailability.mockResolvedValue({ available: true, error: null })
    mockSignUp.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderLogin()

    // Go to signup and submit
    await user.click(screen.getByText('signup'))
    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('nicknamePlaceholder'), 'TestUser')
    await user.click(screen.getByRole('button', { name: 'checkAvailability' }))
    await screen.findByTestId('nickname-available')

    await user.type(screen.getByPlaceholderText('passwordPlaceholder'), 'Abcd123!')
    await user.type(screen.getByPlaceholderText('confirmPasswordPlaceholder'), 'Abcd123!')
    await user.click(screen.getByRole('button', { name: 'signupButton' }))

    // Now in success view
    expect(screen.getByText('emailVerification.title')).toBeInTheDocument()
    expect(screen.getByText('a@b.com')).toBeInTheDocument()

    // Click back to login
    await user.click(screen.getByText('emailVerification.backToLogin'))
    expect(screen.getByPlaceholderText('your@email.com')).toBeInTheDocument()
  })
})
