import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../stores/auth-store'
import { localizeAuthError } from '../../lib/auth-errors'
import { validatePassword, validatePasswordMatch } from '../../lib/password-validation'

type Mode = 'login' | 'signup' | 'forgot'

function PasswordRuleIndicator({ password }: { password: string }) {
  const { t } = useTranslation('auth')
  const result = validatePassword(password)

  const rules = [
    { key: 'passwordRules.tooShort', passed: !result.errors.includes('passwordRules.tooShort') },
    { key: 'passwordRules.needsLetter', passed: !result.errors.includes('passwordRules.needsLetter') },
    { key: 'passwordRules.needsNumber', passed: !result.errors.includes('passwordRules.needsNumber') },
    { key: 'passwordRules.needsSymbol', passed: !result.errors.includes('passwordRules.needsSymbol') },
  ]

  return (
    <div className="text-xs space-y-1" data-testid="password-rules">
      <p className="text-gray-500 font-medium">{t('passwordRules.title')}</p>
      {rules.map((rule) => (
        <div key={rule.key} className={`flex items-center gap-1.5 ${rule.passed ? 'text-green-600' : 'text-gray-400'}`}>
          <span>{rule.passed ? '\u2713' : '\u25CB'}</span>
          <span>{t(rule.key)}</span>
        </div>
      ))}
    </div>
  )
}

export function LoginPage() {
  const { t } = useTranslation('auth')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [mode, setMode] = useState<Mode>('login')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Nickname check state
  const [nicknameChecked, setNicknameChecked] = useState(false)
  const [nicknameAvailable, setNicknameAvailable] = useState(false)
  const [nicknameCheckLoading, setNicknameCheckLoading] = useState(false)
  const [nicknameCheckError, setNicknameCheckError] = useState<string | null>(null)

  const signIn = useAuthStore((s) => s.signIn)
  const signUp = useAuthStore((s) => s.signUp)
  const resetPassword = useAuthStore((s) => s.resetPassword)
  const checkNicknameAvailability = useAuthStore((s) => s.checkNicknameAvailability)
  const navigate = useNavigate()

  const switchMode = (newMode: Mode) => {
    setMode(newMode)
    setError(null)
    setSuccessMessage(null)
    setPassword('')
    setConfirmPassword('')
    setNickname('')
    setNicknameChecked(false)
    setNicknameAvailable(false)
    setNicknameCheckError(null)
  }

  const handleNicknameChange = (value: string) => {
    setNickname(value)
    // Reset check state when nickname changes
    setNicknameChecked(false)
    setNicknameAvailable(false)
    setNicknameCheckError(null)
  }

  const handleNicknameCheck = async () => {
    if (!nickname.trim()) return
    setNicknameCheckLoading(true)
    setNicknameCheckError(null)

    const { available, error } = await checkNicknameAvailability(nickname)
    setNicknameCheckLoading(false)
    setNicknameChecked(true)

    if (error) {
      setNicknameCheckError(t('nicknameCheckFailed'))
      setNicknameAvailable(false)
    } else {
      setNicknameAvailable(available)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    if (mode === 'forgot') {
      const { error } = await resetPassword(email)
      setLoading(false)
      if (error) {
        setError(t(localizeAuthError(error.message) as string))
      } else {
        setSuccessMessage(t('resetLinkSent'))
      }
      return
    }

    if (mode === 'signup') {
      // 1. Nickname check required
      if (!nicknameChecked || !nicknameAvailable) {
        setError(t('nicknameCheckRequired'))
        setLoading(false)
        return
      }

      // 2. Password rules
      const pwResult = validatePassword(password)
      if (!pwResult.valid) {
        setError(t(pwResult.errors[0]))
        setLoading(false)
        return
      }

      // 3. Password match
      if (!validatePasswordMatch(password, confirmPassword)) {
        setError(t('passwordRules.mismatch'))
        setLoading(false)
        return
      }

      const { error } = await signUp(email, password, nickname.trim())
      setLoading(false)
      if (error) {
        setError(t(localizeAuthError(error.message) as string))
      } else {
        setSuccessMessage(t('emailVerification.signupSuccess'))
      }
      return
    }

    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) {
      setError(t(localizeAuthError(error.message) as string))
    } else {
      const params = new URLSearchParams(window.location.search)
      const redirectTo = params.get('redirect') || '/dashboard'
      // Prevent open redirect — only allow same-origin relative paths
      const safePath = /^\/[a-zA-Z0-9]/.test(redirectTo) ? redirectTo : '/dashboard'
      navigate(safePath, { replace: true })
    }
  }

  if (successMessage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full mx-4 text-center">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8">
            <div className="text-5xl mb-4">📧</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">{t('emailVerification.title')}</h2>
            <p className="text-gray-500 mb-2">
              <span className="font-medium text-gray-700">{email}</span>
            </p>
            <p className="text-gray-500 mb-6">{successMessage}</p>
            <button
              onClick={() => switchMode('login')}
              className="text-sm text-blue-600 hover:text-blue-800 cursor-pointer"
            >
              {t('emailVerification.backToLogin')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const title = { login: t('loginTitle'), signup: t('signupTitle'), forgot: t('forgotPasswordTitle') }[mode]
  const submitLabel = { login: t('loginButton'), signup: t('signupButton'), forgot: t('sendResetLink') }[mode]
  const loadingLabel = { login: t('loggingIn'), signup: t('signingUp'), forgot: t('sending') }[mode]

  const isSubmitDisabled =
    loading ||
    !email ||
    (mode !== 'forgot' && !password) ||
    (mode === 'signup' && !nickname.trim()) ||
    (mode === 'signup' && !confirmPassword)

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8">
          <div className="text-center mb-6 sm:mb-8">
            <Link to="/" className="inline-block no-underline">
              <img src="/favicon.png" alt="" className="w-16 h-16 mx-auto mb-3" />
              <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-10 mx-auto" />
            </Link>
            <p className="text-gray-500 mt-3">{title}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition text-gray-900"
            />

            {mode === 'signup' && (
              <div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => handleNicknameChange(e.target.value)}
                    placeholder={t('nicknamePlaceholder')}
                    required
                    minLength={2}
                    maxLength={12}
                    className="flex-1 px-4 py-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition text-gray-900"
                  />
                  <button
                    type="button"
                    onClick={handleNicknameCheck}
                    disabled={!nickname.trim() || nicknameCheckLoading}
                    className="px-4 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer text-sm whitespace-nowrap border border-gray-300"
                  >
                    {nicknameCheckLoading ? t('checking') : t('checkAvailability')}
                  </button>
                </div>
                {nicknameChecked && nicknameAvailable && (
                  <p className="text-xs text-green-600 mt-1" data-testid="nickname-available">{t('nicknameAvailable')}</p>
                )}
                {nicknameChecked && !nicknameAvailable && !nicknameCheckError && (
                  <p className="text-xs text-red-600 mt-1" data-testid="nickname-taken">{t('nicknameTaken')}</p>
                )}
                {nicknameCheckError && (
                  <p className="text-xs text-red-600 mt-1" data-testid="nickname-check-error">{nicknameCheckError}</p>
                )}
              </div>
            )}

            {mode !== 'forgot' && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('passwordPlaceholder')}
                required
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition text-gray-900"
              />
            )}

            {mode === 'signup' && password.length > 0 && (
              <PasswordRuleIndicator password={password} />
            )}

            {mode === 'signup' && (
              <div>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('confirmPasswordPlaceholder')}
                  required
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition text-gray-900"
                />
                {confirmPassword && !validatePasswordMatch(password, confirmPassword) && (
                  <p className="text-xs text-red-600 mt-1" data-testid="password-mismatch">{t('passwordRules.mismatch')}</p>
                )}
              </div>
            )}

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            {mode === 'login' && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="text-sm text-gray-400 hover:text-blue-600 cursor-pointer"
                >
                  {t('forgotPasswordLink')}
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
            >
              {loading ? loadingLabel : submitLabel}
            </button>
          </form>

          <div className="text-sm text-center mt-6 text-gray-500 space-y-1">
            {mode === 'forgot' ? (
              <button
                onClick={() => switchMode('login')}
                className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
              >
                {t('backToLogin')}
              </button>
            ) : (
              <p>
                {mode === 'signup' ? t('alreadyHaveAccount') : t('noAccount')}{' '}
                <button
                  onClick={() => switchMode(mode === 'signup' ? 'login' : 'signup')}
                  className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                >
                  {mode === 'signup' ? t('login') : t('signup')}
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
