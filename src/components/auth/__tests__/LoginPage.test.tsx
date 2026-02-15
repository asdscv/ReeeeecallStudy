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

// ─── Login mode ─────────────────────────────────────────────
describe('Login mode', () => {
  it('should render login form by default', () => {
    renderLogin()
    expect(screen.getByRole('button', { name: '로그인' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('your@email.com')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('비밀번호 (6자 이상)')).toBeInTheDocument()
  })

  it('should disable submit when fields are empty', () => {
    renderLogin()
    const btn = screen.getByRole('button', { name: '로그인' })
    expect(btn).toBeDisabled()
  })

  it('should call signIn and navigate on success', async () => {
    mockSignIn.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('비밀번호 (6자 이상)'), 'pass123')
    await user.click(screen.getByRole('button', { name: '로그인' }))

    expect(mockSignIn).toHaveBeenCalledWith('a@b.com', 'pass123')
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true })
  })

  it('should show error message on signIn failure', async () => {
    mockSignIn.mockResolvedValue({ error: new Error('Invalid credentials') })
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('비밀번호 (6자 이상)'), 'wrong')
    await user.click(screen.getByRole('button', { name: '로그인' }))

    expect(screen.getByText('Invalid credentials')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('should show "비밀번호를 잊으셨나요?" link', () => {
    renderLogin()
    expect(screen.getByText('비밀번호를 잊으셨나요?')).toBeInTheDocument()
  })

  it('should switch to signup mode', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByText('회원가입'))

    // In signup mode, text changes to "이미 계정이 있으신가요?"
    expect(screen.getByText('이미 계정이 있으신가요?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '회원가입' })).toBeInTheDocument()
  })
})

// ─── Signup mode ────────────────────────────────────────────
describe('Signup mode', () => {
  const goToSignup = async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByText('회원가입'))
    return user
  }

  it('should show signup form after switching', async () => {
    await goToSignup()
    // Submit button should say 회원가입
    const buttons = screen.getAllByText('회원가입')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
  })

  it('should validate password length < 6', async () => {
    mockSignUp.mockResolvedValue({ error: null })
    const user = await goToSignup()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('비밀번호 (6자 이상)'), '123')

    // Submit button — find the one that's a submit type
    const submitBtn = screen.getByRole('button', { name: '회원가입' })
    await user.click(submitBtn)

    expect(screen.getByText('비밀번호는 6자 이상이어야 합니다.')).toBeInTheDocument()
    expect(mockSignUp).not.toHaveBeenCalled()
  })

  it('should call signUp and show success message', async () => {
    mockSignUp.mockResolvedValue({ error: null })
    const user = await goToSignup()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('비밀번호 (6자 이상)'), 'pass123')
    await user.click(screen.getByRole('button', { name: '회원가입' }))

    expect(mockSignUp).toHaveBeenCalledWith('a@b.com', 'pass123')
    expect(screen.getByText('이메일을 확인해주세요')).toBeInTheDocument()
  })

  it('should show error on signUp failure', async () => {
    mockSignUp.mockResolvedValue({ error: new Error('Email taken') })
    const user = await goToSignup()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('비밀번호 (6자 이상)'), 'pass123')
    await user.click(screen.getByRole('button', { name: '회원가입' }))

    expect(screen.getByText('Email taken')).toBeInTheDocument()
  })

  it('should switch back to login with "로그인" link', async () => {
    const user = await goToSignup()
    await user.click(screen.getByText('로그인'))
    // Should now show login form
    expect(screen.getByText('비밀번호를 잊으셨나요?')).toBeInTheDocument()
  })
})

// ─── Forgot password mode ───────────────────────────────────
describe('Forgot password mode', () => {
  const goToForgot = async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByText('비밀번호를 잊으셨나요?'))
    return user
  }

  it('should show forgot form without password input', async () => {
    await goToForgot()

    expect(screen.getByPlaceholderText('your@email.com')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('비밀번호 (6자 이상)')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '재설정 링크 보내기' })).toBeInTheDocument()
  })

  it('should call resetPassword and show success message', async () => {
    mockResetPassword.mockResolvedValue({ error: null })
    const user = await goToForgot()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.click(screen.getByRole('button', { name: '재설정 링크 보내기' }))

    expect(mockResetPassword).toHaveBeenCalledWith('a@b.com')
    expect(screen.getByText('이메일을 확인해주세요')).toBeInTheDocument()
  })

  it('should show error on resetPassword failure', async () => {
    mockResetPassword.mockResolvedValue({ error: new Error('Rate limit') })
    const user = await goToForgot()

    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.click(screen.getByRole('button', { name: '재설정 링크 보내기' }))

    expect(screen.getByText('Rate limit')).toBeInTheDocument()
  })

  it('should switch back to login with "로그인으로 돌아가기"', async () => {
    const user = await goToForgot()
    await user.click(screen.getByText('로그인으로 돌아가기'))
    expect(screen.getByText('비밀번호를 잊으셨나요?')).toBeInTheDocument()
  })
})

// ─── Success message view ───────────────────────────────────
describe('Success message view', () => {
  it('should show "로그인 페이지로 돌아가기" button and switch back', async () => {
    mockSignUp.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderLogin()

    // Go to signup and submit
    await user.click(screen.getByText('회원가입'))
    await user.type(screen.getByPlaceholderText('your@email.com'), 'a@b.com')
    await user.type(screen.getByPlaceholderText('비밀번호 (6자 이상)'), 'pass123')
    await user.click(screen.getByRole('button', { name: '회원가입' }))

    // Now in success view
    expect(screen.getByText('이메일을 확인해주세요')).toBeInTheDocument()
    expect(screen.getByText('a@b.com')).toBeInTheDocument()

    // Click back to login
    await user.click(screen.getByText('로그인 페이지로 돌아가기'))
    expect(screen.getByPlaceholderText('your@email.com')).toBeInTheDocument()
  })
})
